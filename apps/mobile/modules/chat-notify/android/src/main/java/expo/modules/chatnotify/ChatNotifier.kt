package expo.modules.chatnotify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.LocusIdCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Draws one notification per chat in Android's chat style
 * (MESSAGE_NOTIFICATIONS_PLAN.md 5-12): the sender's photo, the unread lines,
 * pictures, "You:" replies, Reply / Mark as read / Play, a private lock-screen
 * version, a conversation shortcut, and the group summary.
 *
 * If anything goes wrong, a plain "New message" is shown instead - a chat push
 * must always end in something visible (Firebase downgrades phones whose
 * high-priority pushes show nothing).
 */
object ChatNotifier {
  const val CHANNEL = "messages"
  private const val GROUP = "iem-chats"
  private const val SUMMARY_ID = 0x1E3C
  /** More messages in the same chat within this time update quietly (section 10). */
  private const val BURST_MS = 10_000L

  const val EXTRA_MATCH = "matchId"
  const val EXTRA_MESSAGE = "messageId"
  const val REPLY_KEY = "reply"

  fun notificationId(matchId: String) = matchId.hashCode()

  /** Draws (or redraws) a chat. `alert`: sound and pop-up allowed for this change. */
  fun show(context: Context, matchId: String, alert: Boolean, silent: Boolean = false, hideFromShade: Boolean = false) {
    val state = ChatStore.get(context, matchId) ?: return cancel(context, matchId)
    val now = System.currentTimeMillis()
    val lines = state.lines.filter { it.expiresAt == null || it.expiresAt > now }
    if (lines.isEmpty()) return cancel(context, matchId)
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    ensureChannel(context)
    val loud = alert && !silent && now - state.lastAlertAt > BURST_MS
    try {
      post(context, state.copy(lines = lines), loud, hideFromShade)
    } catch (error: Throwable) {
      fallback(context, matchId, state.previews, state.title)
    }
    if (loud) ChatStore.update(context, matchId) { it?.copy(lastAlertAt = now) }
    scheduleExpiry(context, lines)
  }

  private fun post(context: Context, state: ChatState, loud: Boolean, hideFromShade: Boolean = false) {
    val selfId = ChatNotifyConfig.userId(context) ?: "me"
    val me = Person.Builder().setName("You").setKey(selfId).build()
    val avatar = MediaFetcher.bitmap(state.avatarPath)
    val other = Person.Builder()
      .setName(state.title)
      .setKey(state.lines.firstOrNull { !it.self && it.senderId.isNotBlank() }?.senderId ?: state.matchId)
      .setImportant(true)
      .apply { if (avatar != null) setIcon(IconCompat.createWithAdaptiveBitmap(avatar)) }
      .build()

    val style = NotificationCompat.MessagingStyle(me)
      .setConversationTitle(null)
      .setGroupConversation(false)
    if (state.hidden > 0) {
      style.addHistoricMessage(NotificationCompat.MessagingStyle.Message("+${state.hidden} more messages", state.lines.first().time - 1, other))
    }
    for (line in state.lines) {
      val sender = if (line.self) null else other
      val text = lineText(line, state.previews)
      // A picture is its own message, then the caption as text (Google's guidance).
      val picture = line.imagePath?.let { MediaFetcher.shareable(context, it) }
      if (picture != null && state.previews) {
        style.addMessage(NotificationCompat.MessagingStyle.Message(text, line.time, sender).setData("image/jpeg", picture))
      } else {
        style.addMessage(NotificationCompat.MessagingStyle.Message(text, line.time, sender))
      }
    }

    val shortcutId = shortcut(context, state, other, avatar != null)
    val latest = state.lines.last()
    val count = state.lines.count { !it.self } + state.hidden
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(smallIcon(context))
      .setColor(0xFFF3C1CA.toInt())
      .setContentTitle(if (state.previews) state.title else "IEM Connect")
      .setContentText(lineText(latest, state.previews))
      .setStyle(style)
      .setShortcutId(shortcutId)
      .setLocusId(LocusIdCompat("chat_${state.matchId}"))
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setWhen(latest.time)
      .setShowWhen(true)
      .setAutoCancel(true)
      .setOnlyAlertOnce(!loud)
      .setSilent(!loud)
      .setNumber(count)
      .setGroup(GROUP)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setContentIntent(openChat(context, state.matchId, state.lastPushId))
      .setDeleteIntent(action(context, ChatActionReceiver.ACTION_DISMISSED, state.matchId, null))
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(context, state, count))
      .apply { if (avatar != null) setLargeIcon(avatar) }

    // Play first: some phones (ColorOS, MIUI) show only the first two buttons
    // until the notification is expanded. The newest voice note not yet played (section 7).
    val voice = state.lines.lastOrNull { it.kind == "voice" && !it.self && !it.played }
    if (voice != null && state.voicePlay) {
      builder.addAction(NotificationCompat.Action.Builder(android.R.drawable.ic_media_play, "Play", VoicePlaybackService.playIntent(context, state.matchId, voice.id)).build())
    }
    // Reply (with the phone's own suggestions, if allowed) and Mark as read.
    val reply = RemoteInput.Builder(REPLY_KEY).setLabel("Write a reply…").build()
    builder.addAction(
      NotificationCompat.Action.Builder(0, "Reply", action(context, ChatActionReceiver.ACTION_REPLY, state.matchId, null, mutable = true))
        .addRemoteInput(reply)
        .setAllowGeneratedReplies(state.smartReplies)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .build(),
    )
    builder.addAction(
      NotificationCompat.Action.Builder(0, "Mark as read", action(context, ChatActionReceiver.ACTION_READ, state.matchId, null))
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
        .setShowsUserInterface(false)
        .build(),
    )

    // A floating chat head, if the person allows bubbles for this chat (section 12).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bubbleIntent = PendingIntent.getActivity(
        context, notificationId(state.matchId),
        Intent(context, ChatBubbleActivity::class.java)
          .setAction(Intent.ACTION_VIEW)
          .setData(Uri.parse("iemdating://bubble/${state.matchId}"))
          .putExtra(EXTRA_MATCH, state.matchId)
          .putExtra("title", state.title),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
      val bubbleIcon = avatar?.let { IconCompat.createWithAdaptiveBitmap(it) }
        ?: IconCompat.createWithResource(context, context.applicationInfo.icon)
      builder.setBubbleMetadata(NotificationCompat.BubbleMetadata.Builder(bubbleIntent, bubbleIcon)
        .setDesiredHeight(640)
        // Read in the bubble: the notification leaves the shade, the bubble stays.
        .setSuppressNotification(hideFromShade)
        .build())
    }

    val manager = NotificationManagerCompat.from(context)
    manager.notify(notificationId(state.matchId), builder.build())
    summary(context)
  }

  /** The lock screen's version: who and how many, never what (section 11). */
  private fun publicVersion(context: Context, state: ChatState, count: Int) =
    NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(smallIcon(context))
      .setColor(0xFFF3C1CA.toInt())
      .setContentTitle(if (state.previews) state.title else "IEM Connect")
      .setContentText(if (count == 1) "New message" else "$count new messages")
      .build()

  /** One line's text, by message type (section 4). */
  private fun lineText(line: ChatLine, previews: Boolean = true): CharSequence {
    if (!previews) return ChatNotificationText.hidden(line.kind)
    val base = when (line.kind) {
      "voice" -> ChatNotificationText.body("voice", null, true, seconds = line.voiceSeconds) + if (line.played) " · Played" else ""
      "photo" -> line.text.ifEmpty { "📷 Photo" }
      "video" -> line.text.ifEmpty { "🎥 Video" }
      "document" -> line.text.ifEmpty { "📄 Document" }
      else -> line.text.ifEmpty { "New message" }
    }
    return when {
      line.failed != null -> "$base  ⚠ ${line.failed}"
      line.sending -> "$base  · Sending…"
      else -> base
    }
  }

  /** A long-lived conversation shortcut: Android's Conversations section, priority chats (section 12). */
  private fun shortcut(context: Context, state: ChatState, person: Person, hasAvatar: Boolean): String =
    publishShortcut(context, state.matchId, state.title, state.avatarPath?.takeIf { hasAvatar }, person)

  /**
   * One chat's shortcut, made when a notification shows and when the chat is
   * opened in the app (same id both times): the Conversations section, chats
   * on the app icon, and "Share to <name>" in Android's share sheet (section 12).
   */
  fun publishShortcut(context: Context, matchId: String, name: String, avatarPath: String?, person: Person? = null): String {
    val id = "chat_$matchId"
    runCatching {
      val avatar = MediaFetcher.bitmap(avatarPath)
      val icon = avatar?.let { IconCompat.createWithAdaptiveBitmap(it) } ?: IconCompat.createWithResource(context, context.applicationInfo.icon)
      val who = person ?: Person.Builder().setName(name).setKey(matchId).setImportant(true)
        .apply { if (avatar != null) setIcon(IconCompat.createWithAdaptiveBitmap(avatar)) }.build()
      val shortcut = ShortcutInfoCompat.Builder(context, id)
        .setShortLabel(name)
        .setLongLived(true)
        .setIsConversation()
        .setLocusId(LocusIdCompat(id))
        .setPerson(who)
        .setIcon(icon)
        // Matches the share target in the app's shortcuts.xml (plugins/withShareTargets.js).
        .setCategories(setOf("${context.packageName}.category.CHAT_SHARE"))
        .setIntent(Intent(Intent.ACTION_VIEW, Uri.parse("iemdating://chat/$matchId")).setPackage(context.packageName))
        .build()
      ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
    }
    return id
  }

  fun removeShortcut(context: Context, matchId: String) {
    runCatching { ShortcutManagerCompat.removeLongLivedShortcuts(context, listOf("chat_$matchId")) }
    runCatching { ShortcutManagerCompat.removeDynamicShortcuts(context, listOf("chat_$matchId")) }
  }

  /** "IEM Connect · 3 chats" - folds the chats together (section 5). */
  private fun summary(context: Context) {
    val chats = ChatStore.all(context).filter { it.lines.isNotEmpty() }
    val manager = NotificationManagerCompat.from(context)
    if (chats.size < 2) {
      manager.cancel(SUMMARY_ID)
      return
    }
    val inbox = NotificationCompat.InboxStyle()
    chats.sortedByDescending { it.lines.last().time }.take(5).forEach {
      inbox.addLine(if (it.previews) "${it.title}: ${lineText(it.lines.last())}" else "New message")
    }
    manager.notify(SUMMARY_ID, NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(smallIcon(context))
      .setColor(0xFFF3C1CA.toInt())
      .setContentTitle("${chats.size} chats")
      .setStyle(inbox.setSummaryText("${chats.size} chats"))
      .setGroup(GROUP)
      .setGroupSummary(true)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setAutoCancel(true)
      .setSilent(true)
      .setContentIntent(openUrl(context, "iemdating://main/Chats", SUMMARY_ID))
      .build())
  }

  /** Something visible, whatever went wrong. */
  fun fallback(context: Context, matchId: String, previews: Boolean, title: String?) {
    ensureChannel(context)
    runCatching {
      NotificationManagerCompat.from(context).notify(notificationId(matchId), NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(smallIcon(context))
        .setColor(0xFFF3C1CA.toInt())
        .setContentTitle(if (previews && !title.isNullOrBlank()) title else "IEM Connect")
        .setContentText("New message")
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setAutoCancel(true)
        .setContentIntent(openChat(context, matchId))
        .build())
    }
  }

  fun cancel(context: Context, matchId: String) {
    val manager = NotificationManagerCompat.from(context)
    manager.cancel(notificationId(matchId))
    summary(context)
  }

  /**
   * Whether this chat is showing as a bubble now. A bubble belongs to its
   * notification: cancelling the notification closes the bubble, so a bubbled
   * chat is never cancelled - only hidden from the shade.
   */
  fun isBubbled(context: Context, matchId: String): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    return runCatching {
      context.getSystemService(NotificationManager::class.java).activeNotifications.any {
        it.id == notificationId(matchId) && (it.notification.flags and android.app.Notification.FLAG_BUBBLE) != 0
      }
    }.getOrDefault(false)
  }

  /** Read, opened, muted, unmatched: the chat's notification and lines go. */
  fun forget(context: Context, matchId: String, endBubble: Boolean = false) {
    // Open as a bubble (being read right there): keep the bubble, hide the notification.
    if (!endBubble && isBubbled(context, matchId)) {
      show(context, matchId, alert = false, hideFromShade = true)
      return
    }
    val state = ChatStore.get(context, matchId)
    ChatStore.remove(context, matchId)
    MediaFetcher.deletePictures(context, state?.lines?.mapNotNull { it.imagePath } ?: emptyList())
    cancel(context, matchId)
  }

  fun forgetAll(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    ChatStore.all(context).forEach {
      manager.cancel(notificationId(it.matchId))
      removeShortcut(context, it.matchId)
    }
    manager.cancel(SUMMARY_ID)
    runCatching { ShortcutManagerCompat.removeAllDynamicShortcuts(context) }
    ChatStore.clear(context)
    MediaFetcher.clear(context)
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) != null) return
    // Normally made by the app (push/channels.ts); this covers a push before the first open.
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "New messages and reactions from your matches."
      lightColor = 0xFFFF5A5F.toInt()
    })
  }

  private fun smallIcon(context: Context): Int {
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
  }

  /** Opens the chat; the push id lets the app count the open (NOTIFICATIONS_PLAN.md 13). */
  fun openChat(context: Context, matchId: String, pushId: String? = null): PendingIntent =
    openUrl(context, "iemdating://chat/$matchId" + (pushId?.let { "?pushId=$it" } ?: ""), notificationId(matchId))

  private fun openUrl(context: Context, url: String, code: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun action(context: Context, action: String, matchId: String, messageId: String?, mutable: Boolean = false): PendingIntent {
    val intent = Intent(context, ChatActionReceiver::class.java).setAction(action)
      .putExtra(EXTRA_MATCH, matchId)
      .apply { if (messageId != null) putExtra(EXTRA_MESSAGE, messageId) }
    // A reply needs a mutable intent: Android writes the typed text into it.
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
    return PendingIntent.getBroadcast(context, "$action:$matchId".hashCode(), intent, flags)
  }

  /** Disappearing messages leave the notification at their time (section 9). */
  private fun scheduleExpiry(context: Context, lines: List<ChatLine>) {
    val next = lines.mapNotNull { it.expiresAt }.minOrNull() ?: return
    ChatWork.redrawAt(context, next)
  }
}
