package expo.modules.chatmedia

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import java.io.File
import java.io.FileOutputStream

/** Frames and metadata for the video editor, read with MediaMetadataRetriever. */
object VideoFrames {
  private fun open(context: Context, uri: String): MediaMetadataRetriever {
    val retriever = MediaMetadataRetriever()
    val parsed = Uri.parse(uri)
    try {
      when (parsed.scheme) {
        null -> retriever.setDataSource(uri)
        "file" -> retriever.setDataSource(parsed.path)
        else -> retriever.setDataSource(context, parsed)
      }
    } catch (error: Exception) {
      runCatching { retriever.release() }
      throw IllegalArgumentException("The video could not be opened", error)
    }
    return retriever
  }

  private fun sizeOf(context: Context, uri: String): Long {
    val parsed = Uri.parse(uri)
    return runCatching {
      if (parsed.scheme == null) File(uri).length()
      else context.contentResolver.openFileDescriptor(parsed, "r")?.use { it.statSize } ?: 0L
    }.getOrDefault(0L)
  }

  fun info(context: Context, uri: String): Map<String, Any?> {
    val retriever = open(context, uri)
    try {
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val rawWidth = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val rawHeight = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val sideways = rotation == 90 || rotation == 270
      return mapOf(
        "durationMs" to durationMs.toDouble(),
        "width" to (if (sideways) rawHeight else rawWidth),
        "height" to (if (sideways) rawWidth else rawHeight),
        "hasAudio" to (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"),
        "bitrate" to (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toDoubleOrNull() ?: 0.0),
        "size" to sizeOf(context, uri).toDouble(),
      )
    } finally {
      runCatching { retriever.release() }
    }
  }

  private fun cacheDir(context: Context): File =
    File(context.cacheDir, "chat-media-frames").apply { mkdirs() }

  private fun key(uri: String): String = Integer.toHexString(uri.hashCode())

  private fun scaledFrame(retriever: MediaMetadataRetriever, timeUs: Long, option: Int, maxHeight: Int): Bitmap? {
    val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
    val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
    val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    val sideways = rotation == 90 || rotation == 270
    val displayWidth = if (sideways) height else width
    val displayHeight = if (sideways) width else height
    if (Build.VERSION.SDK_INT >= 27 && displayWidth > 0 && displayHeight > 0 && displayHeight > maxHeight) {
      val targetHeight = maxHeight
      val targetWidth = (displayWidth.toLong() * targetHeight / displayHeight).toInt().coerceAtLeast(1)
      // Bounds are applied to the rotated frame on every API level that has this call.
      return retriever.getScaledFrameAtTime(timeUs, option, targetWidth, targetHeight)
    }
    val frame = retriever.getFrameAtTime(timeUs, option) ?: return null
    if (frame.height <= maxHeight) return frame
    val scaled = Bitmap.createScaledBitmap(frame, (frame.width.toLong() * maxHeight / frame.height).toInt().coerceAtLeast(1), maxHeight, true)
    if (scaled !== frame) frame.recycle()
    return scaled
  }

  private fun write(bitmap: Bitmap, file: File, quality: Int) {
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }
    bitmap.recycle()
  }

  /**
   * Evenly spaced frames for the trim timeline. Nearest keyframes are used
   * because the strip is a sketch of the video, and exact frames would take
   * seconds to decode for a long clip.
   */
  fun strip(context: Context, uri: String, count: Int, maxHeight: Int): List<String> {
    val safeCount = count.coerceIn(1, 30)
    val retriever = open(context, uri)
    try {
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val directory = cacheDir(context)
      return (0 until safeCount).mapNotNull { index ->
        val file = File(directory, "${key(uri)}-strip-$safeCount-$maxHeight-$index.jpg")
        if (!file.exists() || file.length() == 0L) {
          val timeUs = ((index + 0.5) * durationMs / safeCount * 1000).toLong()
          val frame = scaledFrame(retriever, timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, maxHeight) ?: return@mapNotNull null
          write(frame, file, 72)
        }
        Uri.fromFile(file).toString()
      }
    } finally {
      runCatching { retriever.release() }
    }
  }

  /** The exact frame at a time: the cover the recipient will see. */
  fun frameAt(context: Context, uri: String, timeMs: Long, maxHeight: Int): String {
    val retriever = open(context, uri)
    try {
      val file = File(cacheDir(context), "${key(uri)}-frame-${timeMs.coerceAtLeast(0)}-$maxHeight.jpg")
      if (!file.exists() || file.length() == 0L) {
        val frame = scaledFrame(retriever, timeMs.coerceAtLeast(0) * 1000, MediaMetadataRetriever.OPTION_CLOSEST, maxHeight)
          ?: scaledFrame(retriever, timeMs.coerceAtLeast(0) * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, maxHeight)
          ?: throw IllegalStateException("No frame at ${timeMs}ms")
        write(frame, file, 88)
      }
      return Uri.fromFile(file).toString()
    } finally {
      runCatching { retriever.release() }
    }
  }
}
