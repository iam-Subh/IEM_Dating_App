package expo.modules.glasssurface

import android.content.Context
import android.graphics.Canvas
import android.graphics.RenderNode
import android.os.Build
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Draws React Native content normally, then records only the area that can sit
 * behind the composer. The recorded node is a secondary blur source. It never
 * becomes the primary rendering path for the message list.
 *
 * The old implementation drew the list only through this RenderNode. A stale
 * or incomplete recording could therefore turn real message rows black. This
 * arrangement limits a missed recording to one stale glass frame.
 */
class GlassSourceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  internal val source = if (Build.VERSION.SDK_INT >= 31) RenderNode("GlassSource") else null
  private val captureHeightPx get() = (320f * resources.displayMetrics.density).toInt().coerceAtMost(height)

  override fun dispatchDraw(canvas: Canvas) {
    // Keep the list on Android's normal drawing path.
    super.dispatchDraw(canvas)

    val node = source
    if (node == null || !canvas.isHardwareAccelerated || width == 0 || height == 0) {
      return
    }
    node.setPosition(0, 0, width, height)
    val recordingCanvas = node.beginRecording()
    val saveCount = recordingCanvas.save()
    try {
      // Composer glass never samples the top of the chat. Clipping here lets
      // Android reject most off-screen row display lists during recording.
      recordingCanvas.clipRect(0, height - captureHeightPx, width, height)
      super.dispatchDraw(recordingCanvas)
    } finally {
      recordingCanvas.restoreToCount(saveCount)
      node.endRecording()
    }
  }

  override fun onDetachedFromWindow() {
    source?.discardDisplayList()
    super.onDetachedFromWindow()
  }
}
