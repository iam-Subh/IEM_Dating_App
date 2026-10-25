package expo.modules.chatnotify

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The lines of each chat's notification (MESSAGE_NOTIFICATIONS_PLAN.md 5): the
 * unread messages since the chat was last opened, kept so a new message can
 * redraw the whole notification - also after the app was killed. Small: at
 * most MAX_LINES per chat, cleared when the chat is read or opened.
 */
data class ChatLine(
  val id: String,
  val senderId: String,
  val senderName: String,
  val self: Boolean,
  val kind: String,
  val text: String,
  val time: Long,
  val imagePath: String? = null,
  val expiresAt: Long? = null,
  val voiceSeconds: Int? = null,
  val played: Boolean = false,
  val sending: Boolean = false,
  val failed: String? = null,
  val mediaCount: Int = 1,
  val fileName: String? = null,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("senderId", senderId).put("senderName", senderName).put("self", self)
    .put("kind", kind).put("text", text).put("time", time)
    .putOpt("imagePath", imagePath).putOpt("expiresAt", expiresAt).putOpt("voiceSeconds", voiceSeconds)
    .put("played", played).put("sending", sending).putOpt("failed", failed)
    .put("mediaCount", mediaCount).putOpt("fileName", fileName)

  companion object {
    fun from(json: JSONObject) = ChatLine(
      id = json.getString("id"),
      senderId = json.optString("senderId"),
      senderName = json.optString("senderName"),
      self = json.optBoolean("self"),
      kind = json.optString("kind", "text"),
      text = json.optString("text"),
      time = json.optLong("time"),
      imagePath = json.optString("imagePath").ifEmpty { null },
      expiresAt = if (json.has("expiresAt")) json.optLong("expiresAt") else null,
      voiceSeconds = if (json.has("voiceSeconds")) json.optInt("voiceSeconds") else null,
      played = json.optBoolean("played"),
      sending = json.optBoolean("sending"),
      failed = json.optString("failed").ifEmpty { null },
      mediaCount = json.optInt("mediaCount", 1),
      fileName = json.optString("fileName").ifEmpty { null },
    )
  }
}

data class ChatState(
  val matchId: String,
  val title: String,
  val avatarPath: String?,
  val previews: Boolean,
  val smartReplies: Boolean,
  val voicePlay: Boolean,
  val newMatch: Boolean,
  val lines: List<ChatLine>,
  /** Messages beyond the kept lines: "+12 more messages". */
  val hidden: Int,
  val lastAlertAt: Long,
  /** The latest push for this chat: a tap or a button counts as its open (NOTIFICATIONS_PLAN.md 13). */
  val lastPushId: String? = null,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("matchId", matchId).put("title", title).putOpt("avatarPath", avatarPath)
    .put("previews", previews).put("smartReplies", smartReplies).put("voicePlay", voicePlay)
    .put("newMatch", newMatch).put("hidden", hidden).put("lastAlertAt", lastAlertAt).putOpt("lastPushId", lastPushId)
    .put("lines", JSONArray().apply { lines.forEach { put(it.toJson()) } })

  companion object {
    fun from(json: JSONObject): ChatState {
      val array = json.optJSONArray("lines") ?: JSONArray()
      return ChatState(
        matchId = json.getString("matchId"),
        title = json.optString("title", "New message"),
        avatarPath = json.optString("avatarPath").ifEmpty { null },
        previews = json.optBoolean("previews"),
        smartReplies = json.optBoolean("smartReplies", true),
        voicePlay = json.optBoolean("voicePlay", true),
        newMatch = json.optBoolean("newMatch"),
        lines = (0 until array.length()).map { ChatLine.from(array.getJSONObject(it)) },
        hidden = json.optInt("hidden"),
        lastAlertAt = json.optLong("lastAlertAt"),
        lastPushId = json.optString("lastPushId").ifEmpty { null },
      )
    }
  }
}

object ChatStore {
  private const val PREFS = "chat_notify_lines"
  const val MAX_LINES = 7
  private val lock = Any()

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun get(context: Context, matchId: String): ChatState? = synchronized(lock) {
    prefs(context).getString(matchId, null)?.let { runCatching { ChatState.from(JSONObject(it)) }.getOrNull() }
  }

  fun all(context: Context): List<ChatState> = synchronized(lock) {
    prefs(context).all.values.mapNotNull { value ->
      (value as? String)?.let { runCatching { ChatState.from(JSONObject(it)) }.getOrNull() }
    }
  }

  fun put(context: Context, state: ChatState) = synchronized(lock) {
    // Older lines fold into "+N more" so the notification stays short.
    val overflow = (state.lines.size - MAX_LINES).coerceAtLeast(0)
    val kept = state.copy(lines = state.lines.takeLast(MAX_LINES), hidden = state.hidden + overflow)
    prefs(context).edit().putString(state.matchId, kept.toJson().toString()).apply()
    kept
  }

  /** Changes one chat atomically; returning null removes it. */
  fun update(context: Context, matchId: String, change: (ChatState?) -> ChatState?): ChatState? = synchronized(lock) {
    val next = change(get(context, matchId))
    if (next == null) {
      prefs(context).edit().remove(matchId).apply()
      null
    } else put(context, next)
  }

  fun remove(context: Context, matchId: String) = synchronized(lock) {
    prefs(context).edit().remove(matchId).apply()
  }

  fun clear(context: Context) = synchronized(lock) {
    prefs(context).edit().clear().apply()
  }
}
