package expo.modules.chatmedia

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ExportOptions : Record {
  @Field val id: String = ""
  @Field val uri: String = ""
  @Field val startMs: Double = 0.0
  @Field val endMs: Double? = null
  @Field val removeAudio: Boolean = false
}

class UploadPartOptions : Record {
  @Field val partNumber: Int = 0
  @Field val url: String = ""
}

class UploadOptions : Record {
  @Field val jobId: String = ""
  @Field val uri: String = ""
  @Field val partSize: Double = 0.0
  @Field val parts: List<UploadPartOptions> = emptyList()
  @Field val title: String = "Sending media"
}

class StoryFilterRecord : Record {
  @Field val brightness: Double = 0.0
  @Field val contrast: Double = 0.0
  @Field val saturation: Double = 0.0
  @Field val warmth: Double = 0.0
  @Field val grayscale: Boolean = false
}

class StoryTransformRecord : Record {
  @Field val x: Double = 540.0
  @Field val y: Double = 960.0
  @Field val scale: Double = 1.0
  @Field val rotation: Double = 0.0
}

class StoryMusicRecord : Record {
  @Field val url: String = ""
  @Field val startMs: Double = 0.0
  @Field val lengthMs: Double = 0.0
  @Field val videoVolume: Double = 1.0
  @Field val musicVolume: Double = 1.0
}

class StoryItemRecord : Record {
  @Field val itemId: String = ""
  @Field val kind: String = "photo"
  @Field val sourceUri: String = ""
  @Field val clipStartMs: Double? = null
  @Field val clipEndMs: Double? = null
  @Field val muted: Boolean = false
  @Field val filter: StoryFilterRecord? = null
  @Field val transform: StoryTransformRecord? = null
  @Field val fitMode: String = "cover"
  @Field val background: List<String> = emptyList()
  @Field val overlayUri: String? = null
  @Field val music: StoryMusicRecord? = null
}

class StoryBatchRecord : Record {
  @Field val batchId: String = ""
  @Field val apiBaseUrl: String = ""
  @Field val publishToken: String = ""
  @Field val title: String = "Posting your story"
  @Field val items: List<StoryItemRecord> = emptyList()
}

/**
 * Chat media work that needs the platform: video frames for the editor's
 * timeline, trimming and muting through Media3 Transformer, and large uploads
 * that keep running after the app leaves the screen.
 */
class ChatMediaModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val exports = VideoExports()
  private var unsubscribe: (() -> Unit)? = null
  private var unsubscribeStories: (() -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("ChatMedia")
    Events("uploadProgress", "exportProgress", "storyBatchProgress")

    OnCreate {
      unsubscribe = UploadProgressBus.subscribe { jobId, sent, total ->
        sendEvent("uploadProgress", mapOf("jobId" to jobId, "bytesSent" to sent.toDouble(), "totalBytes" to total.toDouble()))
      }
      unsubscribeStories = StoryBatchProgressBus.subscribe { event -> sendEvent("storyBatchProgress", event) }
    }

    OnDestroy {
      unsubscribe?.invoke()
      unsubscribe = null
      unsubscribeStories?.invoke()
      unsubscribeStories = null
      exports.cancelAll()
    }

    AsyncFunction("enqueueStoryBatch") Coroutine { record: StoryBatchRecord ->
      withContext(Dispatchers.IO) { StoryBatches.enqueue(context, record) }
    }

    AsyncFunction("getStoryBatch") Coroutine { batchId: String ->
      withContext(Dispatchers.IO) { StoryBatches.status(context, batchId) }
    }

    AsyncFunction("listStoryBatches") Coroutine { ->
      withContext(Dispatchers.IO) { StoryBatches.list(context) }
    }

    AsyncFunction("retryStoryBatch") Coroutine { batchId: String ->
      withContext(Dispatchers.IO) { StoryBatches.retry(context, batchId) }
    }

    AsyncFunction("cancelStoryBatch") Coroutine { batchId: String ->
      withContext(Dispatchers.IO) { StoryBatches.cancel(context, batchId) }
    }

    AsyncFunction("forgetStoryBatch") Coroutine { batchId: String ->
      withContext(Dispatchers.IO) { StoryBatches.forget(context, batchId) }
    }

    AsyncFunction("saveStoryVideo") Coroutine { item: StoryItemRecord ->
      StoryTools.saveVideo(context, item)
    }

    AsyncFunction("makeBoomerang") Coroutine { uri: String, style: String ->
      StoryTools.boomerang(context, uri, style)
    }

    AsyncFunction("cutoutSubject") Coroutine { uri: String ->
      StoryTools.cutout(context, uri)
    }

    AsyncFunction("applyPhotoEffect") Coroutine { uri: String, effect: String ->
      StoryTools.effect(context, uri, effect)
    }

    AsyncFunction("extractAudio") Coroutine { uri: String, startMs: Double, endMs: Double? ->
      StoryTools.extractAudio(context, uri, startMs.toLong(), endMs?.toLong())
    }

    AsyncFunction("getVideoInfo") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { VideoFrames.info(context, uri) }
    }

    AsyncFunction("generateFrames") Coroutine { uri: String, count: Int, maxHeight: Int ->
      withContext(Dispatchers.IO) { VideoFrames.strip(context, uri, count, maxHeight) }
    }

    AsyncFunction("frameAt") Coroutine { uri: String, timeMs: Double, maxHeight: Int ->
      withContext(Dispatchers.IO) { VideoFrames.frameAt(context, uri, timeMs.toLong(), maxHeight) }
    }

    AsyncFunction("exportVideo") { options: ExportOptions, promise: Promise ->
      exports.start(context, options, promise) { progress ->
        sendEvent("exportProgress", mapOf("id" to options.id, "progress" to progress))
      }
    }

    // Stories: FLAG_SECURE on every app window while the viewer is open (ScreenSecurity).
    AsyncFunction("setScreenCaptureBlocked") { blocked: Boolean ->
      ScreenSecurity.set(appContext.currentActivity, blocked)
    }.runOnQueue(Queues.MAIN)

    Function("cancelExport") { id: String ->
      exports.cancel(id)
    }

    AsyncFunction("enqueueUpload") Coroutine { options: UploadOptions ->
      withContext(Dispatchers.IO) { ChatUploads.enqueue(context, options) }
    }

    AsyncFunction("getUpload") Coroutine { jobId: String ->
      withContext(Dispatchers.IO) { ChatUploads.status(context, jobId) }
    }

    AsyncFunction("cancelUpload") Coroutine { jobId: String ->
      withContext(Dispatchers.IO) { ChatUploads.cancel(context, jobId) }
    }

    AsyncFunction("forgetUpload") Coroutine { jobId: String ->
      withContext(Dispatchers.IO) { ChatUploads.forget(context, jobId) }
    }

    // A message's media sending, in the status bar (TransferNotifications).
    Function("showTransferProgress") { key: String, title: String, percent: Int ->
      TransferNotifications.progress(context, key, title, percent)
    }
    Function("finishTransfer") { key: String, title: String, text: String?, ok: Boolean ->
      TransferNotifications.finish(context, key, title, text, ok)
    }
    Function("cancelTransfer") { key: String ->
      TransferNotifications.cancel(context, key)
    }
  }
}
