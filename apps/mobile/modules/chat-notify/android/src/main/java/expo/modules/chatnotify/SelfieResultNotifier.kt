package expo.modules.chatnotify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.notifications.model.RemoteNotificationContent
import org.json.JSONObject

/** A compact Android status notification, without a checkmark or a large image. */
object SelfieResultNotifier {
  fun accepts(data: JSONObject, remote: RemoteMessage): Boolean =
    data.optString("kind") == "real_person_verified" ||
      (data.optString("kind") == "real_person_review" &&
        RemoteNotificationContent(remote).title == "You're verified as a real person ✓")

  /** False lets Expo handle the push if native rendering fails. */
  fun show(context: Context, remote: RemoteMessage, data: JSONObject): Boolean {
    val owner = data.optString("userId")
    val current = ChatNotifyConfig.userId(context)
    if (owner.isNotEmpty() && current != null && owner != current) return true
    if (ChatNotifyConfig.appForeground && !ChatNotifyConfig.bannersEnabled) return true
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return true
    return runCatching {
      val content = RemoteNotificationContent(remote)
      val channelId = remote.data["channelId"]?.takeIf { it == "verification" || it == "picks" } ?: "verification"
      ensureChannel(context, channelId)
      val key = data.optString("notificationId").ifEmpty { data.optString("pushId").ifEmpty { "selfie-result:$owner" } }
      val url = Uri.parse("iemdating://main/Profile").buildUpon().apply {
        data.optString("pushId").takeIf { it.isNotEmpty() }?.let { appendQueryParameter("pushId", it) }
      }.build()
      val intent = Intent(Intent.ACTION_VIEW, url).setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val open = PendingIntent.getActivity(context, key.hashCode(), intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val body = "Your profile photos match your selfie."
      val notification = NotificationCompat.Builder(context, channelId)
        .setSmallIcon(R.drawable.ic_selfie_status)
        .setLargeIcon(faceIcon(context))
        .setColor(0xFFD5C1F2.toInt())
        .setContentTitle("Selfie check complete")
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setContentIntent(open)
        .addAction(0, "View profile", open)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(true)
        .setWhen(remote.sentTime.takeIf { it > 0 } ?: System.currentTimeMillis())
        .setSilent(data.optBoolean("silent") || (!content.shouldPlayDefaultSound && content.soundName == null))
        .build()
      manager.notify("selfie-result", key.hashCode(), notification)
    }.isSuccess
  }

  private fun faceIcon(context: Context): Bitmap {
    val bitmap = Bitmap.createBitmap(144, 144, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawCircle(72f, 72f, 72f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF393045.toInt() })
    ContextCompat.getDrawable(context, R.drawable.ic_selfie_status)?.mutate()?.apply {
      setTint(0xFFD5C1F2.toInt())
      setBounds(34, 34, 110, 110)
      draw(canvas)
    }
    return bitmap
  }

  private fun ensureChannel(context: Context, id: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(id) != null) return
    manager.createNotificationChannel(NotificationChannel(id,
      if (id == "picks") "Picks and tips" else "Verification",
      if (id == "picks") NotificationManager.IMPORTANCE_LOW else NotificationManager.IMPORTANCE_DEFAULT).apply {
        lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
      })
  }
}
