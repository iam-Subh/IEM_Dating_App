package expo.modules.chatnotify

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject
import java.time.Instant

/**
 * Every push reaches this service first (MESSAGE_NOTIFICATIONS_PLAN.md 3).
 * Chat pushes are drawn here, in Kotlin, with no JavaScript start-up - fast,
 * and working with the app killed. Selfie results use a compact status
 * notification. Other pushes go on to Expo.
 *
 * Expo's push service puts our data in the `body` field as a JSON string.
 */
class ChatMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val raw = remoteMessage.data["body"]?.let { runCatching { JSONObject(it) }.getOrNull() }
    // Encrypted for this phone: Google carried only ciphertext (section 11).
    val data = if (raw?.optString("type") == "enc") PushCrypto.open(this, raw) ?: return unreadable(raw) else raw
    if (data != null && SelfieResultNotifier.accepts(data, remoteMessage) &&
      SelfieResultNotifier.show(this, remoteMessage, data)) return
    when (data?.optString("type")) {
      "chat" -> handle(data) { onChat(it) }
      "chat_reaction" -> handle(data) { onReaction(it) }
      "chat_update" -> handle(data) { onUpdate(it) }
      // Read on another phone, muted, unmatched (section 9).
      "clear" -> handle(data) {
        // The chat ended (unmatch, block): its bubble goes too.
        ChatNotifier.forget(this, it.getString("matchId"), endBubble = it.optBoolean("end"))
        if (it.optBoolean("end")) ChatNotifier.removeShortcut(this, it.getString("matchId"))
      }
      else -> super.onMessageReceived(remoteMessage)
    }
  }

  /**
   * A push this phone can't open (its key changed, e.g. after reinstalling):
   * still something visible, never nothing - Firebase downgrades phones whose
   * high-priority pushes show nothing.
   */
  private fun unreadable(raw: JSONObject) {
    ChatNotifier.fallback(this, "unreadable", false, null)
  }

  private fun handle(data: JSONObject, work: (JSONObject) -> Unit) {
    // A push for another account that once used this phone is dropped (NOTIFICATIONS_PLAN.md 10).
    val owner = data.optString("userId")
    val current = ChatNotifyConfig.userId(this)
    if (owner.isNotEmpty() && current != null && owner != current) return
    try {
      work(data)
    } catch (error: Throwable) {
      val matchId = data.optString("matchId")
      if (data.optString("type") == "chat" && matchId.isNotEmpty()) ChatNotifier.fallback(this, matchId, false, null)
    }
  }

  private fun onChat(data: JSONObject) {
    val matchId = data.getString("matchId")
    val messageId = data.getString("messageId")
    // The grey double tick: this phone has the message, app open or not (section 13).
    ChatWork.delivered(this, matchId, messageId)
    // In the chat right now: the message is on screen, no notification.
    if (ChatNotifyConfig.appForeground && ChatNotifyConfig.activeMatchId == matchId) return
    // App open with in-app banners off: nothing pops up (App settings).
    if (ChatNotifyConfig.appForeground && !ChatNotifyConfig.bannersEnabled) return

    val previews = data.optBoolean("previews")
    val sender = data.optJSONObject("sender")
    val media = data.optJSONObject("media")
    val kind = when (media?.optString("format")) {
      "gif" -> "gif"
      "mixed" -> "media"
      else -> if (data.optString("kind") == "story_reply" && data.optBoolean("storyReaction")) "story_reaction" else data.optString("kind", "text")
    }
    val avatarPath = if (previews) MediaFetcher.avatar(this, sender?.optString("avatar")) else null
    val picture = if (previews && data.optBoolean("photos") && kind in listOf("photo", "video", "gif", "media"))
      MediaFetcher.picture(this, messageId, media?.optString("thumb")) else null
    val line = ChatLine(
      id = messageId,
      senderId = sender?.optString("id").orEmpty(),
      senderName = sender?.optString("name").orEmpty(),
      self = false,
      kind = kind,
      text = text(data, kind, previews),
      time = parseTime(data.optString("sentAt")),
      imagePath = picture,
      expiresAt = data.optString("expiresAt").ifEmpty { null }?.let { parseTime(it) },
      voiceSeconds = if (previews && kind == "voice" && media?.has("durationSec") == true) media.optInt("durationSec") else null,
      mediaCount = media?.optInt("count", 1) ?: 1,
      fileName = if (previews) media?.optString("fileName")?.takeIf { it.isNotBlank() } else null,
    )
    ChatStore.update(this, matchId) { current ->
      val lines = (current?.lines ?: emptyList()).filter { it.id != messageId } + line
      ChatState(
        matchId = matchId,
        title = if (previews) sender?.optString("name")?.ifEmpty { null } ?: current?.title ?: "New message" else "New message",
        avatarPath = avatarPath ?: current?.avatarPath?.takeIf { previews },
        previews = previews,
        smartReplies = data.optBoolean("smartReplies", true),
        voicePlay = data.optBoolean("voicePlay", true),
        newMatch = current?.newMatch ?: data.optBoolean("newMatch"),
        lines = lines.sortedBy { it.time },
        hidden = current?.hidden ?: 0,
        lastAlertAt = current?.lastAlertAt ?: 0,
        lastPushId = data.optString("pushId").ifEmpty { null } ?: current?.lastPushId,
      )
    }
    ChatNotifier.show(this, matchId, alert = true, silent = data.optBoolean("silent"))
    MediaFetcher.sweep(this)
  }

  /** "Riya reacted ❤️ to "see you"" as a line in the chat's notification (section 4). */
  private fun onReaction(data: JSONObject) {
    val matchId = data.getString("matchId")
    if (ChatNotifyConfig.appForeground && ChatNotifyConfig.activeMatchId == matchId) return
    val previews = data.optBoolean("previews")
    val emoji = data.optString("emoji")
    val sender = data.optJSONObject("sender")
    val who = if (previews) sender?.optString("name")?.split(" ")?.firstOrNull()?.ifEmpty { null } else null
    val snippet = data.optString("snippet").ifEmpty { null }
    val text = when {
      !previews -> "New reaction"
      snippet != null -> "Reacted $emoji to “$snippet”"
      else -> "Reacted $emoji to your ${data.optString("subject", "message")}"
    }
    val line = ChatLine(
      id = "reaction:${data.optString("messageId")}:${sender?.optString("id").orEmpty()}",
      senderId = sender?.optString("id").orEmpty(), senderName = who.orEmpty(), self = false,
      kind = "reaction", text = text, time = System.currentTimeMillis(),
    )
    ChatStore.update(this, matchId) { current ->
      (current ?: ChatState(matchId, if (previews) sender?.optString("name") ?: "New message" else "New message", null, previews, true, true, false, emptyList(), 0, 0))
        .let { it.copy(
          title = if (previews) sender?.optString("name")?.takeIf { name -> name.isNotBlank() } ?: it.title else "New message",
          avatarPath = it.avatarPath?.takeIf { previews },
          previews = previews,
          lines = it.lines.filter { existing -> existing.id != line.id } + line,
        ) }
    }
    ChatNotifier.show(this, matchId, alert = true, silent = data.optBoolean("silent"))
  }

  /** Edited or deleted for everyone: the line changes quietly, or goes (section 9). */
  private fun onUpdate(data: JSONObject) {
    val matchId = data.getString("matchId")
    val messageId = data.optString("messageId")
    val action = data.optString("action")
    if (ChatStore.get(this, matchId) == null) return
    ChatStore.update(this, matchId) { current ->
      current ?: return@update null
      val lines = when (action) {
        "delete" -> current.lines.filter { it.id != messageId }
        "edit" -> current.lines.map { line ->
          val text = data.optString("text").ifEmpty { null }
          if (line.id == messageId && text != null && current.previews) line.copy(text = ChatNotificationText.body(
            line.kind, text, true, line.mediaCount, line.voiceSeconds, line.fileName,
          )) else line
        }
        else -> current.lines
      }
      if (lines.isEmpty() && current.hidden == 0) null else current.copy(lines = lines)
    }
    ChatNotifier.show(this, matchId, alert = false)
  }

  /** Reply context is shown inside the chat; the notification previews only the new message. */
  private fun text(data: JSONObject, kind: String, previews: Boolean): String {
    val media = data.optJSONObject("media")
    return ChatNotificationText.body(
      kind = kind,
      text = data.optString("text").takeIf { it.isNotEmpty() },
      previews = previews,
      count = media?.optInt("count", 1) ?: 1,
      seconds = if (media?.has("durationSec") == true) media.optInt("durationSec") else null,
      fileName = media?.optString("fileName"),
    )
  }

  private fun parseTime(value: String): Long =
    runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(System.currentTimeMillis())
}
