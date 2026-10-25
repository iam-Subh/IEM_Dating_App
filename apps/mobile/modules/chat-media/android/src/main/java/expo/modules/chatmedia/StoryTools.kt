package expo.modules.chatmedia

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteOrder
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** The batch job for one story item, as the editor describes it. */
fun storyItemJobOf(item: StoryItemRecord): StoryItemJob = StoryItemJob(
  itemId = item.itemId,
  kind = item.kind,
  sourceUri = item.sourceUri,
  clipStartMs = item.clipStartMs?.toLong(),
  clipEndMs = item.clipEndMs?.toLong(),
  muted = item.muted,
  filter = item.filter?.let { JSONObject().put("brightness", it.brightness).put("contrast", it.contrast).put("saturation", it.saturation).put("warmth", it.warmth).put("grayscale", it.grayscale) },
  transform = item.transform?.let { JSONObject().put("x", it.x).put("y", it.y).put("scale", it.scale).put("rotation", it.rotation) },
  fitMode = item.fitMode,
  background = item.background,
  overlayUri = item.overlayUri,
  music = item.music?.let { JSONObject().put("url", it.url).put("startMs", it.startMs).put("lengthMs", it.lengthMs).put("videoVolume", it.videoVolume).put("musicVolume", it.musicVolume) },
  exportedUri = null,
  status = "pending",
  partSize = 0L,
  parts = mutableListOf(),
  done = mutableSetOf(),
  totalBytes = 0L,
  storyJson = null,
  error = null,
  needsRestart = false,
)

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
  addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }
  addOnFailureListener { if (continuation.isActive) continuation.resumeWithException(it) }
}

/**
 * Story camera and editor tools that need the platform: saving an edited video,
 * Boomerang, subject cutouts, photo effects and audio for captions.
 */
@OptIn(markerClass = [UnstableApi::class])
object StoryTools {
  private fun directory(context: Context, name: String) = File(context.cacheDir, name).apply { mkdirs() }

  // Saving ------------------------------------------------------------------

  /** The edited video as it would be posted (one file, any length). Returns its file URI. */
  suspend fun saveVideo(context: Context, item: StoryItemRecord): String {
    val folder = File(directory(context, "story-saves"), System.currentTimeMillis().toString()).apply { mkdirs() }
    val output = File(folder, "story.mp4")
    StoryExport.export(context, storyItemJobOf(item), output) { }
    return Uri.fromFile(output).toString()
  }

  // Boomerang ---------------------------------------------------------------

  /**
   * A Boomerang from a short clip: frames played forward and back, looped.
   * Classic loops quickly, SloMo at a slower pace, Echo leaves a trail of
   * earlier frames, and Duo slows at each turn and rushes through the middle.
   */
  suspend fun boomerang(context: Context, uri: String, style: String): Map<String, Any> {
    val folder = File(directory(context, "story-boomerang"), "${System.currentTimeMillis()}-$style").apply { mkdirs() }
    val frames = withContext(Dispatchers.IO) { extractFrames(context, uri, folder, echo = style == "echo") }
    if (frames.size < 3) throw IllegalStateException("The clip is too short for a Boomerang")
    val plan = playbackPlan(frames.size, style)
    val sequence = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO))
    for ((index, durationMs) in plan) {
      val media = MediaItem.Builder()
        .setUri(Uri.fromFile(frames[index]))
        .setMimeType(MimeTypes.IMAGE_JPEG)
        .setImageDurationMs(durationMs)
        .build()
      sequence.addItem(EditedMediaItem.Builder(media).setFrameRate(60).build())
    }
    val output = File(folder, "boomerang.mp4")
    transform(context, Composition.Builder(listOf(sequence.build())).build(), output) { it.setVideoMimeType(MimeTypes.VIDEO_H264) }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(frames[0].absolutePath, bounds)
    frames.forEach { it.delete() }
    return mapOf(
      "uri" to Uri.fromFile(output).toString(),
      "durationMs" to plan.sumOf { it.second }.toDouble(),
      "width" to bounds.outWidth,
      "height" to bounds.outHeight,
    )
  }

  private fun playbackPlan(count: Int, style: String): List<Pair<Int, Long>> {
    val forward = (0 until count).toList()
    val backward = (count - 2 downTo 1).toList()
    val pass = forward + backward
    return when (style) {
      "slomo" -> List(2) { pass }.flatten().map { it to 83L }
      "duo" -> List(3) { pass }.flatten().map { index ->
        // Slow near the turning points (the first and last frames), fast between.
        val edge = min(index, count - 1 - index)
        index to (if (edge < 3) 66L else 17L)
      }
      else -> List(4) { pass }.flatten().map { it to 33L }
    }
  }

  private fun extractFrames(context: Context, uri: String, folder: File, echo: Boolean): List<File> {
    val retriever = MediaMetadataRetriever()
    val parsed = Uri.parse(uri)
    when (parsed.scheme) {
      null -> retriever.setDataSource(uri)
      "file" -> retriever.setDataSource(parsed.path)
      else -> retriever.setDataSource(context, parsed)
    }
    try {
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val rawWidth = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val rawHeight = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val sideways = rotation == 90 || rotation == 270
      val portrait = (if (sideways) rawWidth else rawHeight) >= (if (sideways) rawHeight else rawWidth)
      val frameCount = if (Build.VERSION.SDK_INT >= 28) retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toIntOrNull() ?: 0 else 0
      val wanted = 16
      val files = mutableListOf<File>()
      var trail: Bitmap? = null
      for (step in 0 until wanted) {
        val decoded = if (Build.VERSION.SDK_INT >= 28 && frameCount > 1) {
          runCatching { retriever.getFrameAtIndex(((frameCount - 1) * step.toDouble() / (wanted - 1)).roundToInt()) }.getOrNull()
        } else {
          retriever.getFrameAtTime(durationMs * 1000L * step / (wanted - 1), MediaMetadataRetriever.OPTION_CLOSEST)
        } ?: continue
        // Frames should arrive upright; turn any that do not match the video's orientation.
        val upright = if (sideways && (decoded.height >= decoded.width) != portrait) rotate(decoded, rotation) else decoded
        val frame = scaleEven(upright, 1280)
        val output = if (echo && trail != null) {
          frame.copy(Bitmap.Config.ARGB_8888, true).also { mixed ->
            Canvas(mixed).drawBitmap(trail!!, null, Rect(0, 0, mixed.width, mixed.height), Paint(Paint.FILTER_BITMAP_FLAG).apply { alpha = 115 })
          }
        } else frame
        val file = File(folder, "frame-$step.jpg")
        FileOutputStream(file).use { output.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        files += file
        if (echo) {
          trail?.recycle()
          trail = output
          if (output !== frame) frame.recycle()
        } else {
          frame.recycle()
        }
      }
      trail?.recycle()
      return files
    } finally {
      runCatching { retriever.release() }
    }
  }

  private fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
    val turned = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
    if (turned !== bitmap) bitmap.recycle()
    return turned
  }

  /** At most `edge` pixels on the long side, with even dimensions for the encoder. */
  private fun scaleEven(bitmap: Bitmap, edge: Int): Bitmap {
    val ratio = min(1.0, edge.toDouble() / max(bitmap.width, bitmap.height))
    val width = ((bitmap.width * ratio).toInt() / 2 * 2).coerceAtLeast(2)
    val height = ((bitmap.height * ratio).toInt() / 2 * 2).coerceAtLeast(2)
    if (width == bitmap.width && height == bitmap.height) return bitmap
    val scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
    if (scaled !== bitmap) bitmap.recycle()
    return scaled
  }

  // Cutouts -----------------------------------------------------------------

  /** The main subject of a photo on a transparent background, cropped to it. PNG. */
  suspend fun cutout(context: Context, uri: String): Map<String, Any> {
    val image = withContext(Dispatchers.IO) { InputImage.fromFilePath(context, Uri.parse(uri)) }
    val segmenter = SubjectSegmentation.getClient(SubjectSegmenterOptions.Builder().enableForegroundBitmap().build())
    try {
      val result = segmenter.process(image).await()
      val foreground = result.foregroundBitmap ?: throw IllegalStateException("No subject was found in this photo")
      return withContext(Dispatchers.IO) {
        val scaled = scaleEven(foreground, 1600)
        val cropped = cropToContent(scaled) ?: throw IllegalStateException("No subject was found in this photo")
        val file = File(directory(context, "story-cutouts"), "cutout-${System.currentTimeMillis()}.png")
        FileOutputStream(file).use { cropped.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val size = mapOf("uri" to Uri.fromFile(file).toString(), "width" to cropped.width, "height" to cropped.height)
        cropped.recycle()
        size
      }
    } finally {
      segmenter.close()
    }
  }

  private fun cropToContent(bitmap: Bitmap): Bitmap? {
    val width = bitmap.width
    val height = bitmap.height
    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    var left = width
    var top = height
    var right = -1
    var bottom = -1
    for (y in 0 until height) {
      for (x in 0 until width) {
        if (Color.alpha(pixels[y * width + x]) > 24) {
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
    }
    if (right < left || bottom < top) return null
    val cropped = Bitmap.createBitmap(bitmap, left, top, right - left + 1, bottom - top + 1)
    if (cropped !== bitmap) bitmap.recycle()
    return cropped
  }

  // Effects -----------------------------------------------------------------

  /**
   * A photo effect: the background blurred, black and white, or replaced with a
   * studio backdrop (the person found by selfie segmentation), or sunglasses, a
   * crown or hearts placed on each face found. JPEG.
   */
  suspend fun effect(context: Context, uri: String, effect: String): Map<String, Any> {
    val source = withContext(Dispatchers.IO) { decodeScaled(context, uri, 1920) }
    val output = when (effect) {
      "blur", "mono", "studio" -> backgroundEffect(source, effect)
      "glasses", "crown", "hearts" -> faceEffect(source, effect)
      else -> throw IllegalArgumentException("Unknown effect")
    }
    return withContext(Dispatchers.IO) {
      val file = File(directory(context, "story-effects"), "effect-${System.currentTimeMillis()}.jpg")
      FileOutputStream(file).use { output.compress(Bitmap.CompressFormat.JPEG, 92, it) }
      val size = mapOf("uri" to Uri.fromFile(file).toString(), "width" to output.width, "height" to output.height)
      if (output !== source) output.recycle()
      source.recycle()
      size
    }
  }

  private fun decodeScaled(context: Context, uri: String, edge: Int): Bitmap {
    val parsed = Uri.parse(uri)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(parsed)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= edge) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888; inMutable = true }
    val decoded = context.contentResolver.openInputStream(parsed)?.use { BitmapFactory.decodeStream(it, null, options) }
      ?: throw IllegalStateException("The photo could not be read")
    return scaleEven(decoded, edge)
  }

  private suspend fun backgroundEffect(source: Bitmap, effect: String): Bitmap {
    val segmenter = Segmentation.getClient(
      SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE).enableRawSizeMask().build(),
    )
    try {
      val mask = segmenter.process(InputImage.fromBitmap(source, 0)).await()
      return withContext(Dispatchers.Default) {
        val width = source.width
        val height = source.height
        val background = when (effect) {
          "blur" -> blurred(source)
          "mono" -> Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { grey ->
            Canvas(grey).drawBitmap(source, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) }) })
          }
          else -> Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { studio ->
            Canvas(studio).drawRect(0f, 0f, width.toFloat(), height.toFloat(), Paint().apply {
              shader = LinearGradient(0f, 0f, 0f, height.toFloat(), intArrayOf(Color.parseColor("#EDE9E3"), Color.parseColor("#B5AEA4")), null, Shader.TileMode.CLAMP)
            })
          }
        }
        val person = IntArray(width * height)
        val behind = IntArray(width * height)
        source.getPixels(person, 0, width, 0, 0, width, height)
        background.getPixels(behind, 0, width, 0, 0, width, height)
        background.recycle()
        val buffer = mask.buffer.order(ByteOrder.nativeOrder())
        val maskWidth = mask.width
        val maskHeight = mask.height
        for (y in 0 until height) {
          val my = min(maskHeight - 1, y * maskHeight / height)
          for (x in 0 until width) {
            val mx = min(maskWidth - 1, x * maskWidth / width)
            val confidence = buffer.getFloat((my * maskWidth + mx) * 4)
            val amount = ((confidence - 0.35f) / 0.35f).coerceIn(0f, 1f)
            val index = y * width + x
            if (amount >= 1f) continue
            val front = person[index]
            val back = behind[index]
            person[index] = Color.rgb(
              (Color.red(back) + (Color.red(front) - Color.red(back)) * amount).toInt(),
              (Color.green(back) + (Color.green(front) - Color.green(back)) * amount).toInt(),
              (Color.blue(back) + (Color.blue(front) - Color.blue(back)) * amount).toInt(),
            )
          }
        }
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { it.setPixels(person, 0, width, 0, 0, width, height) }
      }
    } finally {
      segmenter.close()
    }
  }

  /**
   * A smooth blur: three box-blur passes (close to a Gaussian) on a quarter-size
   * copy, scaled back up. Scaling alone, without the passes, looked pixelated.
   */
  private fun blurred(source: Bitmap): Bitmap {
    val small = Bitmap.createScaledBitmap(source, max(1, source.width / 4), max(1, source.height / 4), true)
    val width = small.width
    val height = small.height
    val pixels = IntArray(width * height)
    small.getPixels(pixels, 0, width, 0, 0, width, height)
    if (small !== source) small.recycle()
    val radius = max(3, max(width, height) / 45)
    val scratch = IntArray(pixels.size)
    repeat(3) { boxBlur(pixels, scratch, width, height, radius) }
    val blurredSmall = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    val result = Bitmap.createScaledBitmap(blurredSmall, source.width, source.height, true)
    if (result !== blurredSmall) blurredSmall.recycle()
    return result
  }

  /** One horizontal then one vertical running-average pass, edges clamped. */
  private fun boxBlur(pixels: IntArray, scratch: IntArray, width: Int, height: Int, radius: Int) {
    val size = 2 * radius + 1
    for (y in 0 until height) {
      val row = y * width
      var red = 0
      var green = 0
      var blue = 0
      for (offset in -radius..radius) {
        val pixel = pixels[row + offset.coerceIn(0, width - 1)]
        red += (pixel shr 16) and 0xFF
        green += (pixel shr 8) and 0xFF
        blue += pixel and 0xFF
      }
      for (x in 0 until width) {
        scratch[row + x] = (0xFF shl 24) or ((red / size) shl 16) or ((green / size) shl 8) or (blue / size)
        val leaving = pixels[row + (x - radius).coerceIn(0, width - 1)]
        val entering = pixels[row + (x + radius + 1).coerceIn(0, width - 1)]
        red += ((entering shr 16) and 0xFF) - ((leaving shr 16) and 0xFF)
        green += ((entering shr 8) and 0xFF) - ((leaving shr 8) and 0xFF)
        blue += (entering and 0xFF) - (leaving and 0xFF)
      }
    }
    for (x in 0 until width) {
      var red = 0
      var green = 0
      var blue = 0
      for (offset in -radius..radius) {
        val pixel = scratch[offset.coerceIn(0, height - 1) * width + x]
        red += (pixel shr 16) and 0xFF
        green += (pixel shr 8) and 0xFF
        blue += pixel and 0xFF
      }
      for (y in 0 until height) {
        pixels[y * width + x] = (0xFF shl 24) or ((red / size) shl 16) or ((green / size) shl 8) or (blue / size)
        val leaving = scratch[(y - radius).coerceIn(0, height - 1) * width + x]
        val entering = scratch[(y + radius + 1).coerceIn(0, height - 1) * width + x]
        red += ((entering shr 16) and 0xFF) - ((leaving shr 16) and 0xFF)
        green += ((entering shr 8) and 0xFF) - ((leaving shr 8) and 0xFF)
        blue += (entering and 0xFF) - (leaving and 0xFF)
      }
    }
  }

  private suspend fun faceEffect(source: Bitmap, effect: String): Bitmap {
    val detector = FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .build(),
    )
    try {
      val faces = detector.process(InputImage.fromBitmap(source, 0)).await()
      if (faces.isEmpty()) throw IllegalStateException("No face was found in this photo")
      val output = source.copy(Bitmap.Config.ARGB_8888, true)
      val canvas = Canvas(output)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
      for (face in faces) {
        val box = face.boundingBox
        val size = box.width().toFloat()
        val leftEye = face.getLandmark(FaceLandmark.LEFT_EYE)?.position
        val rightEye = face.getLandmark(FaceLandmark.RIGHT_EYE)?.position
        val eyesX = if (leftEye != null && rightEye != null) (leftEye.x + rightEye.x) / 2 else box.exactCenterX()
        val eyesY = if (leftEye != null && rightEye != null) (leftEye.y + rightEye.y) / 2 else box.top + box.height() * 0.4f
        canvas.save()
        // ML Kit's roll is counter-clockwise; the canvas turns clockwise.
        canvas.rotate(-face.headEulerAngleZ, box.exactCenterX(), box.exactCenterY())
        fun emoji(text: String, x: Float, y: Float, textSize: Float) {
          paint.textSize = textSize
          canvas.drawText(text, x, y + textSize * 0.35f, paint)
        }
        when (effect) {
          "glasses" -> emoji("🕶️", eyesX, eyesY, size * 0.95f)
          "crown" -> emoji("👑", box.exactCenterX(), box.top - size * 0.12f, size * 0.75f)
          else -> {
            val radius = size * 0.62f
            for (step in 0 until 5) {
              val angle = Math.toRadians(200.0 + step * 35.0)
              emoji("💖", box.exactCenterX() + (radius * Math.cos(angle)).toFloat(), box.exactCenterY() - size * 0.15f + (radius * Math.sin(angle)).toFloat(), size * 0.24f)
            }
          }
        }
        canvas.restore()
      }
      return output
    } finally {
      detector.close()
    }
  }

  // Captions ----------------------------------------------------------------

  /** The sound of a stretch of video as AAC in an MP4 container, for transcription. */
  suspend fun extractAudio(context: Context, uri: String, startMs: Long, endMs: Long?): String {
    val clipping = MediaItem.ClippingConfiguration.Builder().setStartPositionMs(max(0L, startMs)).apply {
      if (endMs != null && endMs > startMs) setEndPositionMs(endMs)
    }.build()
    val item = EditedMediaItem.Builder(MediaItem.Builder().setUri(Uri.parse(uri)).setClippingConfiguration(clipping).build())
      .setRemoveVideo(true)
      .build()
    val output = File(directory(context, "story-audio"), "audio-${System.currentTimeMillis()}.m4a")
    val sequence = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO)).addItem(item).build()
    transform(context, Composition.Builder(listOf(sequence)).build(), output) { it.setAudioMimeType(MimeTypes.AUDIO_AAC) }
    return Uri.fromFile(output).toString()
  }

  private suspend fun transform(context: Context, composition: Composition, output: File, configure: (Transformer.Builder) -> Transformer.Builder) {
    output.delete()
    withContext(Dispatchers.Main) {
      suspendCancellableCoroutine<Unit> { continuation ->
        val transformer = configure(Transformer.Builder(context))
          .addListener(object : Transformer.Listener {
            override fun onCompleted(composition: Composition, exportResult: ExportResult) {
              if (continuation.isActive) continuation.resume(Unit)
            }

            override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
              if (continuation.isActive) continuation.resumeWithException(IllegalStateException(exportException.message ?: "The media could not be processed", exportException))
            }
          })
          .build()
        continuation.invokeOnCancellation { Handler(Looper.getMainLooper()).post { runCatching { transformer.cancel() } } }
        try {
          transformer.start(composition, output.absolutePath)
        } catch (error: Exception) {
          if (continuation.isActive) continuation.resumeWithException(error)
        }
      }
    }
  }
}
