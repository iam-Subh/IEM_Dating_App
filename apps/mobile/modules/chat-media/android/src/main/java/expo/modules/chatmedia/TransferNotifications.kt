package expo.modules.chatmedia

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Progress and "sent" notifications for media the app uploads itself (chat
 * photos and videos under the background uploader's size): one per message,
 * "Sending 3 photos · 45%", then "3 photos sent" for a few seconds.
 * Large files show ChatUploadWorker's own bar; only the "sent" line comes here.
 */
object TransferNotifications {
  private const val CHANNEL_ID = "chat_media_uploads"
  /** How long a finished line stays before it clears itself. */
  private const val DONE_TIMEOUT_MS = 4_000L

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Media uploads", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Progress of photos, videos and files you send"
        setShowBadge(false)
      })
    }
  }

  private fun idFor(key: String) = 0x6000_0000 or (key.hashCode() and 0x0FFF_FFFF)

  private fun openApp(context: Context): PendingIntent? =
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

  fun progress(context: Context, key: String, title: String, percent: Int) {
    ensureChannel(context)
    val value = percent.coerceIn(0, 100)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(title)
      .setContentText("$value%")
      .setProgress(100, value, value == 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setContentIntent(openApp(context))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(idFor(key), notification)
    } catch (_: SecurityException) {
      // Notifications are off: the upload carries on without a bar.
    }
  }

  /** Replaces the bar with the outcome, which clears itself when it was a success. */
  fun finish(context: Context, key: String, title: String, text: String?, ok: Boolean) {
    ensureChannel(context)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(if (ok) android.R.drawable.stat_sys_upload_done else android.R.drawable.stat_notify_error)
      .setContentTitle(title)
      .apply { if (text != null) setContentText(text) }
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setAutoCancel(true)
      .apply { if (ok) setTimeoutAfter(DONE_TIMEOUT_MS) }
      .setContentIntent(openApp(context))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(idFor(key), notification)
    } catch (_: SecurityException) {
      // Notifications are off.
    }
  }

  fun cancel(context: Context, key: String) {
    runCatching { NotificationManagerCompat.from(context).cancel(idFor(key)) }
  }
}
