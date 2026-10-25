package expo.modules.chatnotify

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Lets the system UI read notification pictures (MESSAGE_NOTIFICATIONS_PLAN.md 6). */
class ChatNotifyFileProvider : FileProvider()

/**
 * Pictures for notifications (MESSAGE_NOTIFICATIONS_PLAN.md 5, 6): sender
 * photos (round, cached a week) and message pictures (shrunk to 512 px,
 * kept until the chat is read, at most 2 days). Every download has a short
 * time limit and a size cap - a slow network means text first, never a
 * missing notification.
 */
object MediaFetcher {
  private const val MAX_BYTES = 12 * 1024 * 1024
  private const val AVATAR_PX = 192
  private const val PICTURE_PX = 512
  private const val WEEK_MS = 7L * 24 * 60 * 60 * 1000
  private const val TWO_DAYS_MS = 2L * 24 * 60 * 60 * 1000

  private fun dir(context: Context, name: String) =
    File(context.cacheDir, "chat-notify/$name").apply { mkdirs() }

  private fun hash(value: String) =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)

  /** Round sender photo, cached by URL. Null if it can't be had in time. */
  fun avatar(context: Context, url: String?, timeoutMs: Int = 4000): String? {
    if (url.isNullOrBlank()) return null
    // Profile photo URLs change when the photo changes, so the URL is the cache key.
    val file = File(dir(context, "avatars"), "${hash(url)}.png")
    if (file.exists() && System.currentTimeMillis() - file.lastModified() < WEEK_MS) return file.absolutePath
    val bitmap = download(url, timeoutMs, AVATAR_PX) ?: return null
    val round = circle(bitmap)
    FileOutputStream(file).use { round.compress(Bitmap.CompressFormat.PNG, 100, it) }
    return file.absolutePath
  }

  /** A message picture, shrunk; null if it can't be had in time. */
  fun picture(context: Context, messageId: String, url: String?, timeoutMs: Int = 5000): String? {
    if (url.isNullOrBlank()) return null
    val file = File(dir(context, "pictures"), "$messageId.jpg")
    if (file.exists()) return file.absolutePath
    val bitmap = download(url, timeoutMs, PICTURE_PX) ?: return null
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 80, it) }
    return file.absolutePath
  }

  /** A content:// link the system UI may read, for MessagingStyle pictures. */
  fun shareable(context: Context, path: String): Uri? = runCatching {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.chatnotify.files", File(path))
    context.grantUriPermission("com.android.systemui", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    uri
  }.getOrNull()

  fun bitmap(path: String?): Bitmap? = path?.let { runCatching { BitmapFactory.decodeFile(it) }.getOrNull() }

  /** Old pictures go; avatars stay a week. */
  fun sweep(context: Context) {
    val now = System.currentTimeMillis()
    dir(context, "pictures").listFiles()?.forEach { if (now - it.lastModified() > TWO_DAYS_MS) it.delete() }
    dir(context, "avatars").listFiles()?.forEach { if (now - it.lastModified() > WEEK_MS) it.delete() }
  }

  fun deletePictures(context: Context, paths: List<String>) {
    paths.forEach { runCatching { File(it).delete() } }
  }

  fun clear(context: Context) {
    File(context.cacheDir, "chat-notify").deleteRecursively()
  }

  private fun download(url: String, timeoutMs: Int, maxSide: Int): Bitmap? = runCatching {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = timeoutMs
    connection.readTimeout = timeoutMs
    try {
      if (connection.responseCode !in 200..299) return null
      if (connection.contentLengthLong > MAX_BYTES) return null
      val bytes = connection.inputStream.use { input ->
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          out.write(buffer, 0, read)
          if (out.size() > MAX_BYTES) return null
        }
        out.toByteArray()
      }
      // Decode at a fraction of the size: a 4000 px photo never sits in memory whole.
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= maxSide && bounds.outHeight / (sample * 2) >= maxSide) sample *= 2
      val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return null
      val scale = maxSide.toFloat() / maxOf(decoded.width, decoded.height)
      if (scale >= 1f) decoded else Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true)
    } finally {
      connection.disconnect()
    }
  }.getOrNull()

  private fun circle(source: Bitmap): Bitmap {
    val size = minOf(source.width, source.height)
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    val left = (source.width - size) / 2
    val top = (source.height - size) / 2
    canvas.drawBitmap(source, Rect(left, top, left + size, top + size), Rect(0, 0, size, size), paint)
    return output
  }
}
