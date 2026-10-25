package expo.modules.chatnotify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import java.util.UUID

/**
 * Reply, Mark as read and swipe-away on a chat notification
 * (MESSAGE_NOTIFICATIONS_PLAN.md 8). The work itself runs in WorkManager
 * (ChatWork), so a reply typed with no network is sent when it returns.
 */
class ChatActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_REPLY = "expo.modules.chatnotify.REPLY"
    const val ACTION_READ = "expo.modules.chatnotify.READ"
    const val ACTION_DISMISSED = "expo.modules.chatnotify.DISMISSED"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val matchId = intent.getStringExtra(ChatNotifier.EXTRA_MATCH) ?: return
    // A button counts as opening the push, with what was pressed (NOTIFICATIONS_PLAN.md 13).
    val pushId = ChatStore.get(context, matchId)?.lastPushId
    val label = when (intent.action) { ACTION_REPLY -> "reply"; ACTION_READ -> "read"; else -> null }
    if (pushId != null && label != null) ChatWork.opened(context, pushId, label)
    when (intent.action) {
      ACTION_REPLY -> {
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(ChatNotifier.REPLY_KEY)?.toString()?.trim()
        if (text.isNullOrEmpty()) return
        val clientId = UUID.randomUUID().toString()
        // Shown at once as "You: … · Sending…" in the same notification.
        ChatStore.update(context, matchId) { current ->
          current?.copy(lines = current.lines + ChatLine(
            id = "local:$clientId", senderId = ChatNotifyConfig.userId(context).orEmpty(), senderName = "You", self = true,
            kind = "text", text = text, time = System.currentTimeMillis(), sending = true,
          ))
        }
        ChatNotifier.show(context, matchId, alert = false)
        ChatWork.reply(context, matchId, text, clientId)
      }
      ACTION_READ -> {
        ChatNotifier.forget(context, matchId)
        ChatWork.read(context, matchId)
      }
      // Swiped away: it stays away; the next message brings back the unread lines.
      ACTION_DISMISSED -> Unit
    }
  }
}
