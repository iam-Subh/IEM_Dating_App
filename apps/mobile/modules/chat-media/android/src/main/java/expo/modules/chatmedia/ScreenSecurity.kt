package expo.modules.chatmedia

import android.app.Activity
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager

/**
 * Blocks screenshots and screen recording while stories are on screen.
 *
 * FLAG_SECURE belongs to a window, not to the app. The activity has one window,
 * but every React Native Modal is a dialog with a window of its own, and a story
 * shown in one would still be captured. So the flag is set on every window the
 * app has open.
 *
 * Unlike a screenshot listener, this registers nothing with the system, so
 * Android 14+ shows no "app detected a screenshot" notice: the capture is
 * simply refused, or comes out black.
 */
object ScreenSecurity {
  private const val SECURE = WindowManager.LayoutParams.FLAG_SECURE

  /** Must run on the main thread. */
  fun set(activity: Activity?, block: Boolean) {
    activity?.window?.let { window ->
      if (block) window.addFlags(SECURE) else window.clearFlags(SECURE)
    }
    applyToDialogs(block)
  }

  /**
   * Dialog windows are reached through the window manager's list of this
   * process's windows. If that list cannot be read on some device, the
   * activity window is still protected.
   */
  private fun applyToDialogs(block: Boolean) {
    try {
      val globalClass = Class.forName("android.view.WindowManagerGlobal")
      val global = globalClass.getMethod("getInstance").invoke(null)
      val viewsField = globalClass.getDeclaredField("mViews").apply { isAccessible = true }
      val paramsField = globalClass.getDeclaredField("mParams").apply { isAccessible = true }
      val updateLayout = globalClass.getMethod("updateViewLayout", View::class.java, ViewGroup.LayoutParams::class.java)
      val views = ArrayList((viewsField.get(global) as? List<*>) ?: emptyList<Any>())
      val params = ArrayList((paramsField.get(global) as? List<*>) ?: emptyList<Any>())
      views.forEachIndexed { index, entry ->
        val view = entry as? View ?: return@forEachIndexed
        val layout = params.getOrNull(index) as? WindowManager.LayoutParams ?: return@forEachIndexed
        val isSecure = (layout.flags and SECURE) != 0
        if (isSecure == block) return@forEachIndexed
        layout.flags = if (block) layout.flags or SECURE else layout.flags and SECURE.inv()
        updateLayout.invoke(global, view, layout)
      }
    } catch (error: Throwable) {
      Log.w("ChatMedia", "Screen security could not reach dialog windows: ${error.message}")
    }
  }
}
