package expo.modules.chatmedia

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.Brightness
import androidx.media3.effect.Contrast
import androidx.media3.effect.HslAdjustment
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.RgbAdjustment
import androidx.media3.effect.RgbFilter
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class StoryExportException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Renders a video story as the editor showed it, into a 1080 × 1920 H.264 MP4.
 *
 * The editor composes on a 1080 × 1920 canvas: a background, the video placed
 * with a position, scale and rotation, a colour filter, and decorative layers
 * (text, drawings, emoji, GIF frames) that the app captured as a transparent
 * image. Here the video gets the filter and placement; the background, with a
 * hole where the video sits, and the decorative image are drawn into one
 * overlay above it; and the music clip is mixed with the video's own sound.
 */
@OptIn(markerClass = [UnstableApi::class])
object StoryExport {
  private const val WIDTH = 1080
  private const val HEIGHT = 1920
  private const val VIDEO_BITRATE = 6_000_000

  suspend fun export(context: Context, item: StoryItemJob, output: File, onProgress: (Double) -> Unit) {
    val prepared = withContext(Dispatchers.IO) { prepare(context, item, output) }
    val temp = File(output.parentFile, "${output.name}.part")
    temp.delete()
    try {
      withContext(Dispatchers.Main) { run(context, prepared, temp, onProgress) }
      if (!temp.renameTo(output)) {
        output.delete()
        if (!temp.renameTo(output)) throw StoryExportException("The exported video could not be saved")
      }
    } finally {
      temp.delete()
      prepared.overlay.recycle()
    }
  }

  private class Prepared(val composition: Composition, val overlay: Bitmap)

  private fun prepare(context: Context, item: StoryItemJob, output: File): Prepared {
    val info = runCatching { VideoFrames.info(context, item.sourceUri) }
      .getOrElse { throw StoryExportException("The video could not be opened", it) }
    val videoWidth = (info["width"] as Number).toInt()
    val videoHeight = (info["height"] as Number).toInt()
    val durationMs = (info["durationMs"] as Number).toLong()
    val hasAudio = info["hasAudio"] as? Boolean ?: false
    if (videoWidth <= 0 || videoHeight <= 0 || durationMs <= 0) throw StoryExportException("The video could not be read")

    val start = (item.clipStartMs ?: 0L).coerceIn(0L, durationMs - 1)
    val end = (item.clipEndMs ?: durationMs).coerceIn(start + 1, durationMs)
    val clipLengthMs = end - start

    val placement = Placement.of(item, videoWidth, videoHeight)
    val overlay = overlayBitmap(context, item, placement)

    val videoEffects = mutableListOf<Effect>()
    videoEffects += colourEffects(item.filter)
    if (abs(placement.rotation) > 0.01) {
      // Media3 turns counter-clockwise; the editor's rotation is clockwise.
      videoEffects += ScaleAndRotateTransformation.Builder().setRotationDegrees(-placement.rotation.toFloat()).build()
    }
    videoEffects += Presentation.createForWidthAndHeight(WIDTH, HEIGHT, Presentation.LAYOUT_SCALE_TO_FIT)
    val zoom = placement.relativeScale.toFloat()
    val shiftX = ((placement.x - WIDTH / 2.0) / (WIDTH / 2.0)).toFloat()
    val shiftY = (-(placement.y - HEIGHT / 2.0) / (HEIGHT / 2.0)).toFloat()
    if (abs(zoom - 1f) > 0.001f || abs(shiftX) > 0.0005f || abs(shiftY) > 0.0005f) {
      videoEffects += MatrixTransformation { _ -> Matrix().apply { postScale(zoom, zoom); postTranslate(shiftX, shiftY) } }
    }
    videoEffects += OverlayEffect(listOf(BitmapOverlay.createStaticBitmapOverlay(overlay)))

    val music = item.music?.takeIf { it.optString("url").startsWith("https://") }
    val keepOriginalAudio = hasAudio && !item.muted
    val videoVolume = (music?.optDouble("videoVolume", 1.0) ?: 1.0).coerceIn(0.0, 1.0)
    val videoAudio = if (keepOriginalAudio && videoVolume < 0.999) listOf(volume(videoVolume.toFloat())) else emptyList()

    val clipping = MediaItem.ClippingConfiguration.Builder().setStartPositionMs(start).setEndPositionMs(end).build()
    val video = EditedMediaItem.Builder(MediaItem.Builder().setUri(Uri.parse(item.sourceUri)).setClippingConfiguration(clipping).build())
      .setRemoveAudio(!keepOriginalAudio)
      .setEffects(Effects(videoAudio, videoEffects))
      .build()

    val sequences = mutableListOf<EditedMediaItemSequence>()
    if (music != null) {
      val file = File(output.parentFile, "${item.itemId}.music.m4a")
      download(music.getString("url"), file)
      val musicStart = music.optDouble("startMs", 0.0).toLong().coerceAtLeast(0L)
      val musicLength = min(music.optDouble("lengthMs", clipLengthMs.toDouble()).toLong(), clipLengthMs).coerceAtLeast(1L)
      val musicClip = MediaItem.ClippingConfiguration.Builder().setStartPositionMs(musicStart).setEndPositionMs(musicStart + musicLength).build()
      val musicVolume = music.optDouble("musicVolume", 1.0).coerceIn(0.0, 1.0).toFloat()
      val song = EditedMediaItem.Builder(MediaItem.Builder().setUri(Uri.fromFile(file)).setClippingConfiguration(musicClip).build())
        .setRemoveVideo(true)
        .setEffects(Effects(listOf(volume(musicVolume)), emptyList()))
        .build()
      // Declaring an audio track on the video's sequence gives the song a
      // silent track to mix into when the video's own sound is off.
      sequences += EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO)).addItem(video).build()
      sequences += EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO)).addItem(song).build()
    } else {
      val tracks = if (keepOriginalAudio) setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO) else setOf(C.TRACK_TYPE_VIDEO)
      sequences += EditedMediaItemSequence.Builder(tracks).addItem(video).build()
    }
    val composition = Composition.Builder(sequences)
      .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
      .build()
    return Prepared(composition, overlay)
  }

  private suspend fun run(context: Context, prepared: Prepared, temp: File, onProgress: (Double) -> Unit) =
    suspendCancellableCoroutine { continuation ->
      val handler = Handler(Looper.getMainLooper())
      val holder = ProgressHolder()
      lateinit var transformer: Transformer
      lateinit var poll: Runnable
      transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(
          DefaultEncoderFactory.Builder(context)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(VIDEO_BITRATE).build())
            .setEnableFallback(true)
            .build(),
        )
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            handler.removeCallbacks(poll)
            if (continuation.isActive) continuation.resume(Unit)
          }

          override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
            handler.removeCallbacks(poll)
            if (continuation.isActive) continuation.resumeWithException(StoryExportException(exportException.message ?: "The video could not be prepared", exportException))
          }
        })
        .build()
      poll = object : Runnable {
        override fun run() {
          if (!continuation.isActive) return
          if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress / 100.0)
          handler.postDelayed(this, 300)
        }
      }
      continuation.invokeOnCancellation {
        handler.post {
          handler.removeCallbacks(poll)
          runCatching { transformer.cancel() }
        }
      }
      try {
        transformer.start(prepared.composition, temp.absolutePath)
        handler.postDelayed(poll, 300)
      } catch (error: Exception) {
        if (continuation.isActive) continuation.resumeWithException(StoryExportException(error.message ?: "The video could not be prepared", error))
      }
    }

  /** Where the video sits on the 1080 × 1920 canvas, and how Media3 must scale it to get there. */
  private class Placement(
    val x: Double,
    val y: Double,
    val rotation: Double,
    /** The video's size on the canvas. */
    val width: Double,
    val height: Double,
    /** Extra scale after Presentation has fitted the (rotated) frame into the canvas. */
    val relativeScale: Double,
  ) {
    companion object {
      fun of(item: StoryItemJob, videoWidth: Int, videoHeight: Int): Placement {
        val transform = item.transform ?: JSONObject()
        val x = transform.optDouble("x", WIDTH / 2.0)
        val y = transform.optDouble("y", HEIGHT / 2.0)
        val scale = transform.optDouble("scale", 1.0).coerceIn(0.05, 20.0)
        val rotation = transform.optDouble("rotation", 0.0)
        val base = if (item.fitMode == "cover") {
          max(WIDTH.toDouble() / videoWidth, HEIGHT.toDouble() / videoHeight)
        } else {
          min(WIDTH.toDouble() / videoWidth, HEIGHT.toDouble() / videoHeight)
        }
        val radians = Math.toRadians(rotation)
        val rotatedWidth = abs(videoWidth * cos(radians)) + abs(videoHeight * sin(radians))
        val rotatedHeight = abs(videoWidth * sin(radians)) + abs(videoHeight * cos(radians))
        val fitted = min(WIDTH / rotatedWidth, HEIGHT / rotatedHeight)
        return Placement(x, y, rotation, videoWidth * base * scale, videoHeight * base * scale, base * scale / fitted)
      }
    }
  }

  /** Background with a hole where the video is, then the editor's decorative layers on top. */
  private fun overlayBitmap(context: Context, item: StoryItemJob, placement: Placement): Bitmap {
    val bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val colours = item.background.mapNotNull { runCatching { Color.parseColor(it) }.getOrNull() }.ifEmpty { listOf(Color.BLACK) }
    val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    if (colours.size == 1) backgroundPaint.color = colours[0]
    else backgroundPaint.shader = LinearGradient(0f, 0f, 0f, HEIGHT.toFloat(), colours.toIntArray(), null, Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, WIDTH.toFloat(), HEIGHT.toFloat(), backgroundPaint)

    canvas.save()
    canvas.rotate(placement.rotation.toFloat(), placement.x.toFloat(), placement.y.toFloat())
    canvas.drawRect(
      (placement.x - placement.width / 2).toFloat(),
      (placement.y - placement.height / 2).toFloat(),
      (placement.x + placement.width / 2).toFloat(),
      (placement.y + placement.height / 2).toFloat(),
      Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) },
    )
    canvas.restore()

    item.overlayUri?.let { uri ->
      val decorations = runCatching {
        context.contentResolver.openInputStream(Uri.parse(uri))?.use { BitmapFactory.decodeStream(it) }
      }.getOrNull() ?: throw StoryExportException("The story's text and drawings could not be read")
      canvas.drawBitmap(decorations, null, RectF(0f, 0f, WIDTH.toFloat(), HEIGHT.toFloat()), Paint(Paint.FILTER_BITMAP_FLAG))
      decorations.recycle()
    }
    return bitmap
  }

  /**
   * The same filter parameters the editor previews with a colour matrix:
   * brightness and contrast in -1..1, saturation in -100..100, warmth in -1..1.
   */
  private fun colourEffects(filter: JSONObject?): List<Effect> {
    if (filter == null) return emptyList()
    val effects = mutableListOf<Effect>()
    val brightness = filter.optDouble("brightness", 0.0).coerceIn(-1.0, 1.0)
    val contrast = filter.optDouble("contrast", 0.0).coerceIn(-0.99, 0.99)
    val saturation = filter.optDouble("saturation", 0.0).coerceIn(-100.0, 100.0)
    val warmth = filter.optDouble("warmth", 0.0).coerceIn(-1.0, 1.0)
    if (filter.optBoolean("grayscale", false)) effects += RgbFilter.createGrayscaleFilter()
    if (abs(saturation) > 0.5) effects += HslAdjustment.Builder().adjustSaturation(saturation.toFloat()).build()
    if (abs(warmth) > 0.005) {
      effects += RgbAdjustment.Builder()
        .setRedScale((1 + 0.12 * warmth).toFloat())
        .setBlueScale((1 - 0.12 * warmth).toFloat())
        .build()
    }
    if (abs(contrast) > 0.005) effects += Contrast(contrast.toFloat())
    if (abs(brightness) > 0.005) effects += Brightness(brightness.toFloat())
    return effects
  }

  private fun volume(gain: Float): AudioProcessor = ChannelMixingAudioProcessor().apply {
    for (channels in 1..2) putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(channels, channels).scaleBy(gain))
  }

  private fun download(url: String, target: File) {
    if (target.exists() && target.length() > 0) return
    val temp = File(target.parentFile, "${target.name}.part")
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 30_000
      readTimeout = 60_000
      instanceFollowRedirects = true
    }
    try {
      if (connection.responseCode !in 200..299) throw java.io.IOException("The song could not be downloaded (HTTP ${connection.responseCode})")
      connection.inputStream.use { input -> temp.outputStream().use { input.copyTo(it) } }
      if (!temp.renameTo(target)) throw java.io.IOException("The song could not be saved")
    } finally {
      connection.disconnect()
      temp.delete()
    }
  }
}
