package expo.modules.chatnotify

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.io.File

/**
 * Shared from another app into IEM Connect (MESSAGE_NOTIFICATIONS_PLAN.md 12):
 * text or a picture, sent straight to a chat ("Share to Riya" in Android's
 * share sheet) or to the app, which then asks which chat. A shared picture is
 * copied at once - the other app's permission to read it ends with the screen.
 */
object ShareIntake {
  private const val HANDLED = "iem.share.handled"

  data class Share(val matchId: String?, val text: String?, val file: String?, val mimeType: String?)

  @Volatile private var pending: Share? = null

  /** Reads a share out of an activity's intent, once. True if it held one. */
  fun capture(context: Context, intent: Intent?): Boolean {
    if (intent == null || intent.action != Intent.ACTION_SEND || intent.getBooleanExtra(HANDLED, false)) return false
    intent.putExtra(HANDLED, true)
    val shortcut = intent.getStringExtra(Intent.EXTRA_SHORTCUT_ID)
    val matchId = shortcut?.removePrefix("chat_")?.takeIf { shortcut.startsWith("chat_") }
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.take(2000)
    val stream = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
    val type = intent.type
    val file = stream?.takeIf { type?.startsWith("image/") == true }?.let { copy(context, it, type) }
    if (text == null && file == null) return false
    pending = Share(matchId, text, file, type)
    return true
  }

  fun take(): Share? = pending.also { pending = null }

  private fun copy(context: Context, uri: Uri, type: String?): String? = runCatching {
    val ext = when (type) { "image/png" -> "png"; "image/webp" -> "webp"; else -> "jpg" }
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    val target = File(dir, "share-${System.currentTimeMillis()}.$ext")
    context.contentResolver.openInputStream(uri)?.use { input -> target.outputStream().use { input.copyTo(it) } } ?: return null
    // 30 MB: the chat's own photo limit is far above any shared screenshot.
    if (target.length() > 30L * 1024 * 1024) { target.delete(); return null }
    target.absolutePath
  }.getOrNull()
}
