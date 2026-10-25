package expo.modules.chatmedia

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.Promise
import java.io.File
import java.util.UUID

/**
 * Trims and mutes videos with Media3 Transformer.
 *
 * With no trim the video track is copied untouched and only the audio is
 * dropped. A trim re-encodes at most the stretch before the first keyframe
 * inside the range when trim optimization applies, and the whole clip when it
 * does not. Transformer is single-threaded on the looper it was built on, so
 * everything here runs on the main looper.
 */
@OptIn(markerClass = [UnstableApi::class])
class VideoExports {
  private class Job(val transformer: Transformer, val promise: Promise, val output: File, val poll: Runnable)

  private val handler = Handler(Looper.getMainLooper())
  private val jobs = mutableMapOf<String, Job>()

  fun start(context: Context, options: ExportOptions, promise: Promise, onProgress: (Double) -> Unit) {
    handler.post {
      if (jobs.containsKey(options.id)) {
        promise.reject("ERR_EXPORT_BUSY", "This video is already being prepared", null)
        return@post
      }
      val output = File(File(context.cacheDir, "chat-media-exports").apply { mkdirs() }, "${UUID.randomUUID()}.mp4")
      try {
        val start = options.startMs.toLong().coerceAtLeast(0)
        val end = options.endMs?.toLong()
        val clipping = MediaItem.ClippingConfiguration.Builder()
          .setStartPositionMs(start)
          .apply { if (end != null && end > start) setEndPositionMs(end) }
          .build()
        val item = MediaItem.Builder().setUri(Uri.parse(options.uri)).setClippingConfiguration(clipping).build()
        val edited = EditedMediaItem.Builder(item).setRemoveAudio(options.removeAudio).build()
        val trimmed = start > 0 || end != null
        val holder = ProgressHolder()

        lateinit var job: Job
        val transformer = Transformer.Builder(context)
          .experimentalSetTrimOptimizationEnabled(trimmed)
          .addListener(object : Transformer.Listener {
            @Suppress("DEPRECATION")
            override fun onCompleted(composition: Composition, exportResult: ExportResult) {
              finish(options.id, job)
              promise.resolve(mapOf(
                "uri" to Uri.fromFile(output).toString(),
                "size" to output.length().toDouble(),
                "durationMs" to exportResult.durationMs.toDouble(),
              ))
            }

            override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
              finish(options.id, job)
              output.delete()
              promise.reject("ERR_EXPORT_FAILED", exportException.message ?: "The video could not be prepared", exportException)
            }
          })
          .build()

        val poll = object : Runnable {
          override fun run() {
            if (jobs[options.id] !== job) return
            if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
              onProgress(holder.progress / 100.0)
            }
            handler.postDelayed(this, 200)
          }
        }
        job = Job(transformer, promise, output, poll)
        jobs[options.id] = job
        transformer.start(edited, output.absolutePath)
        handler.postDelayed(poll, 200)
      } catch (error: Exception) {
        jobs.remove(options.id)
        output.delete()
        promise.reject("ERR_EXPORT_FAILED", error.message ?: "The video could not be prepared", error)
      }
    }
  }

  private fun finish(id: String, job: Job) {
    handler.removeCallbacks(job.poll)
    if (jobs[id] === job) jobs.remove(id)
  }

  fun cancel(id: String) {
    handler.post {
      val job = jobs.remove(id) ?: return@post
      handler.removeCallbacks(job.poll)
      // cancel() does not call the listener, so the caller's promise is settled here.
      runCatching { job.transformer.cancel() }
      job.output.delete()
      job.promise.reject("ERR_EXPORT_CANCELLED", "Video preparation was cancelled", null)
    }
  }

  fun cancelAll() {
    handler.post { jobs.keys.toList().forEach { cancel(it) } }
  }
}
