package expo.modules.chatmedia

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

private class ApiException(val status: Int, val code: String?, message: String) : IOException(message)
private class TokenRevokedException(message: String) : Exception(message)
private class BatchCancelledException : Exception("This post was cancelled")

/**
 * Posts one Story batch in the background: for each story in order, export a
 * video (photos arrive rendered), upload it in parts, then publish it.
 *
 * It needs no JavaScript and no open screen. It authenticates with the batch's
 * publish token, never the user's session, whose refresh tokens rotate. Every
 * step can be interrupted and resumed: an export is renamed into place only
 * when complete, uploaded parts are remembered, and publishing is idempotent.
 */
class StoryBatchWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  companion object {
    const val KEY_BATCH_ID = "batchId"
    const val KEY_ERROR = "error"
    private const val CHANNEL_ID = "story_posting"
    private const val MAX_RUN_ATTEMPTS = 30
    private const val PART_ATTEMPTS = 3
  }

  private var lastProgressAt = 0L
  private var lastNotificationAt = 0L

  override suspend fun getForegroundInfo(): ForegroundInfo {
    val batchId = inputData.getString(KEY_BATCH_ID).orEmpty()
    return foregroundInfo(batchId, 0.0, 1)
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val batchId = inputData.getString(KEY_BATCH_ID) ?: return@withContext Result.failure(workDataOf(KEY_ERROR to "The post is missing its id"))
    val job = StoryBatches.read(applicationContext, batchId)
      ?: return@withContext Result.failure(workDataOf(KEY_ERROR to "The post is no longer on this device"))
    if (job.status == "cancelled") return@withContext Result.success()

    try {
      setForeground(foregroundInfo(batchId, overallProgress(job, -1, 0.0), job.items.size))
    } catch (_: IllegalStateException) {
      // Android 12+ refuses a foreground service started from the background.
      // The work still runs under JobScheduler's limits and resumes next run.
    }

    for ((index, item) in job.items.withIndex()) {
      if (isStopped) return@withContext Result.retry()
      if (item.status in setOf("published", "rejected", "cancelled")) continue
      try {
        processItem(job, index, item)
      } catch (_: BatchCancelledException) {
        job.status = "cancelled"
        job.items.forEach { if (it.status !in setOf("published", "rejected")) it.status = "cancelled" }
        StoryBatches.save(applicationContext, job)
        emit(job, index, "cancelled", 0.0)
        cancelProgressNotification(batchId)
        return@withContext Result.success()
      } catch (error: TokenRevokedException) {
        return@withContext failBatch(job, error.message ?: "This post can no longer be published")
      } catch (error: StoryExportException) {
        // A video this phone cannot export will never post. Skip it on the
        // server so the stories after it are not held back.
        item.status = "rejected"
        item.error = error.message ?: "The video could not be prepared"
        StoryBatches.save(applicationContext, job)
        runCatching { call(job, "/items/${item.itemId}/skip", JSONObject().put("reason", item.error)) }
        emit(job, index, "rejected", 1.0)
      } catch (error: IOException) {
        if (isStopped) return@withContext Result.retry()
        return@withContext if (runAttemptCount + 1 >= MAX_RUN_ATTEMPTS) failBatch(job, "Posting kept failing. Check your connection and try again")
        else Result.retry()
      }
    }

    job.status = if (job.items.any { it.status == "rejected" }) "failed" else "completed"
    job.error = job.items.firstOrNull { it.status == "rejected" }?.error
    StoryBatches.save(applicationContext, job)
    emit(job, job.items.size - 1, job.status, 1.0)
    cancelProgressNotification(batchId)
    if (job.status == "completed") {
      notifyDone(batchId, if (job.items.size > 1) "Your stories were posted" else "Your story was posted", "Tap to see it", ok = true)
    } else {
      notifyDone(batchId, "Some stories couldn't be posted", job.error ?: "Open the app to try again.")
    }
    StoryBatches.outputDir(applicationContext, batchId).deleteRecursively()
    Result.success()
  }

  private fun failBatch(job: StoryBatchJob, message: String): Result {
    job.items.forEach { if (it.status == "pending") { it.status = "failed"; it.error = message } }
    job.status = "failed"
    job.error = message
    StoryBatches.save(applicationContext, job)
    emit(job, -1, "failed", 0.0)
    cancelProgressNotification(job.batchId)
    notifyDone(job.batchId, "Couldn't post your story", "Open the app to try again.")
    return Result.failure(workDataOf(KEY_ERROR to message))
  }

  private suspend fun processItem(job: StoryBatchJob, index: Int, item: StoryItemJob) {
    if (item.kind == "video") {
      val exported = item.exportedUri?.let { Uri.parse(it).path }?.let(::File)
      if (exported == null || !exported.exists() || exported.length() == 0L) {
        // Producing the file again gives different bytes; parts of the old
        // file must not be assembled with the new one.
        if (item.parts.isNotEmpty() || item.done.isNotEmpty()) item.needsRestart = true
        emit(job, index, "exporting", 0.0)
        val output = File(StoryBatches.outputDir(applicationContext, job.batchId), "${item.itemId}.mp4")
        StoryExport.export(applicationContext, item, output) { progress -> emit(job, index, "exporting", progress * 0.35) }
        item.exportedUri = Uri.fromFile(output).toString()
        item.parts.clear()
        item.done.clear()
        StoryBatches.save(applicationContext, job)
      }
    }
    val uri = item.exportedUri ?: item.sourceUri
    val size = sizeOf(uri)

    var rounds = 0
    while (true) {
      if (isStopped) throw IOException("Posting stopped")
      if (item.parts.isEmpty()) {
        refreshParts(job, item, size)
        if (item.status != "pending") {
          emit(job, index, item.status, 1.0)
          return
        }
      }
      val uploaded = uploadMissing(job, index, item, uri)
      if (!uploaded) continue
      emit(job, index, "publishing", 0.95)
      if (publish(job, item)) {
        emit(job, index, "published", 1.0)
        return
      }
      if (item.status != "pending") {
        emit(job, index, item.status, 1.0)
        return
      }
      rounds += 1
      if (rounds >= 3) throw IOException("The upload did not complete")
    }
  }

  private fun sizeOf(uri: String): Long {
    val parsed = Uri.parse(uri)
    val size = if (parsed.scheme == null) File(uri).length()
    else applicationContext.contentResolver.openFileDescriptor(parsed, "r")?.use { it.statSize } ?: -1L
    if (size <= 0) throw StoryExportException("The story file is no longer on this device")
    return size
  }

  private fun refreshParts(job: StoryBatchJob, item: StoryItemJob, size: Long) {
    val data = try {
      call(job, "/items/${item.itemId}/parts", JSONObject().put("size", size).put("restart", item.needsRestart))
    } catch (error: ApiException) {
      handleItemError(job, item, error)
      return
    }
    when (data.optString("status")) {
      "published" -> { item.status = "published"; StoryBatches.save(applicationContext, job); return }
      "rejected" -> { item.status = "rejected"; item.error = "This story could not be posted"; StoryBatches.save(applicationContext, job); return }
      "cancelled" -> throw BatchCancelledException()
    }
    val parts = data.optJSONArray("parts") ?: JSONArray()
    val uploaded = data.optJSONArray("uploadedPartNumbers") ?: JSONArray()
    item.partSize = data.optLong("partSize", 0L)
    item.totalBytes = size
    item.parts.clear()
    item.parts.addAll((0 until parts.length()).map { parts.getJSONObject(it).let { part -> part.getInt("partNumber") to part.getString("url") } })
    item.done.clear()
    item.done.addAll((0 until uploaded.length()).map { uploaded.getInt(it) })
    item.needsRestart = false
    StoryBatches.save(applicationContext, job)
  }

  /** Returns false when the part URLs must be fetched again first. */
  private suspend fun uploadMissing(job: StoryBatchJob, index: Int, item: StoryItemJob, uri: String): Boolean {
    if (item.partSize <= 0) {
      // Already assembled on the server.
      return true
    }
    val descriptor = try {
      applicationContext.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
    } catch (_: Exception) {
      null
    } ?: throw StoryExportException("The story file is no longer on this device")

    descriptor.use { fd ->
      FileInputStream(fd.fileDescriptor).channel.use { channel ->
        for ((number, url) in item.parts.sortedBy { it.first }) {
          if (isStopped) throw IOException("Posting stopped")
          if (number in item.done) continue
          val length = item.partLength(number)
          if (length <= 0) continue
          var attempt = 0
          while (true) {
            try {
              PartUpload.upload(channel, (number - 1).toLong() * item.partSize, length, url, { isStopped }) { sent ->
                emit(job, index, "uploading", uploadFraction(item, item.doneBytes + sent))
              }
              break
            } catch (error: HttpStatusException) {
              if (error.code == 403 || error.code == 404) {
                // Expired URLs, or an upload the server replaced: ask again.
                item.parts.clear()
                if (error.code == 404) item.needsRestart = true
                StoryBatches.save(applicationContext, job)
                return false
              }
              attempt += 1
              if (attempt >= PART_ATTEMPTS || isStopped) throw IOException(error.message)
              delay(2_000L * attempt)
            } catch (error: IOException) {
              attempt += 1
              if (attempt >= PART_ATTEMPTS || isStopped) throw error
              delay(2_000L * attempt)
            }
          }
          item.done.add(number)
          StoryBatches.save(applicationContext, job)
          emit(job, index, "uploading", uploadFraction(item, item.doneBytes), force = true)
        }
      }
    }
    return true
  }

  private fun uploadFraction(item: StoryItemJob, sent: Long): Double {
    val base = if (item.kind == "video") 0.35 else 0.0
    val span = 0.95 - base
    return base + span * (if (item.totalBytes > 0) sent.toDouble() / item.totalBytes else 0.0)
  }

  /** Returns true once published; false when parts are missing and must be sent again. */
  private fun publish(job: StoryBatchJob, item: StoryItemJob): Boolean {
    val data = try {
      call(job, "/items/${item.itemId}/publish", JSONObject(), readTimeoutMs = 180_000)
    } catch (error: ApiException) {
      if (error.code == "STORY_UPLOAD_INCOMPLETE") {
        item.parts.clear()
        StoryBatches.save(applicationContext, job)
        return false
      }
      handleItemError(job, item, error)
      return false
    }
    item.status = "published"
    item.error = null
    item.storyJson = data.optJSONObject("story")?.toString()
    StoryBatches.save(applicationContext, job)
    return true
  }

  private fun handleItemError(job: StoryBatchJob, item: StoryItemJob, error: ApiException) {
    when {
      error.status == 401 || error.code == "STORY_TOKEN_SCOPE" || error.code == "STORY_TOKEN_REVOKED" -> throw TokenRevokedException(error.message ?: "This post can no longer be published")
      error.code == "STORY_BATCH_CANCELLED" || error.code == "STORY_BATCH_UNAVAILABLE" || error.code == "STORY_BATCH_ITEM_UNAVAILABLE" -> throw BatchCancelledException()
      error.code == "STORY_BATCH_ORDER" || error.code == "STORY_UPLOAD_CONFLICT" || error.status >= 500 || error.status == 408 -> throw IOException(error.message)
      error.status == 429 && error.code != "STORY_QUOTA" -> throw IOException(error.message)
      else -> {
        // Rejected by the server: this story can never post as it is.
        item.status = "rejected"
        item.error = error.message
        StoryBatches.save(applicationContext, job)
      }
    }
  }

  private fun call(job: StoryBatchJob, path: String, body: JSONObject, readTimeoutMs: Int = 60_000): JSONObject {
    val connection = (URL("${job.apiBaseUrl}/stories/batches/${job.batchId}$path").openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      doOutput = true
      connectTimeout = 30_000
      readTimeout = readTimeoutMs
      setRequestProperty("Authorization", "Bearer ${job.publishToken}")
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Accept", "application/json")
    }
    try {
      connection.outputStream.use { it.write(body.toString().toByteArray()) }
      val status = connection.responseCode
      val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
        ?.bufferedReader()?.use { it.readText() }.orEmpty()
      val json = runCatching { JSONObject(text) }.getOrNull()
      if (status !in 200..299) {
        throw ApiException(status, json?.optString("code")?.takeIf { it.isNotEmpty() }, json?.optString("message")?.takeIf { it.isNotEmpty() } ?: "The server answered HTTP $status")
      }
      return json?.optJSONObject("data") ?: JSONObject()
    } finally {
      connection.disconnect()
    }
  }

  private fun overallProgress(job: StoryBatchJob, index: Int, itemFraction: Double): Double {
    val total = job.items.size.coerceAtLeast(1)
    val finished = job.items.withIndex().count { (position, item) -> position != index && item.status in setOf("published", "rejected", "cancelled") }
    return ((finished + (if (index >= 0) itemFraction else 0.0)) / total).coerceIn(0.0, 1.0)
  }

  private fun emit(job: StoryBatchJob, index: Int, phase: String, itemFraction: Double, force: Boolean = false) {
    val now = System.currentTimeMillis()
    val terminal = phase in setOf("published", "rejected", "cancelled", "completed", "failed")
    if (!force && !terminal && now - lastProgressAt < 250) return
    lastProgressAt = now
    val progress = overallProgress(job, index, itemFraction)
    val item = job.items.getOrNull(index)
    StoryBatchProgressBus.emit(mapOf(
      "batchId" to job.batchId,
      "itemId" to item?.itemId,
      "phase" to phase,
      "progress" to progress,
      "story" to item?.storyJson,
      "error" to (item?.error ?: job.error),
    ))
    setProgressAsync(workDataOf("progress" to progress))
    if (!terminal && (force || now - lastNotificationAt >= 1_000)) {
      lastNotificationAt = now
      try {
        NotificationManagerCompat.from(applicationContext)
          .notify(notificationId(job.batchId), progressNotification(job.batchId, progress, job.items.size))
      } catch (_: SecurityException) {
        // Notifications are off; posting continues without a visible bar.
      }
    }
  }

  private fun notificationId(batchId: String) = 0x5000_0000 or (batchId.hashCode() and 0x0FFF_FFFF)

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = applicationContext.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Story posting", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Progress of stories you are posting"
        setShowBadge(false)
      })
    }
  }

  private fun openAppIntent(): PendingIntent? =
    applicationContext.packageManager.getLaunchIntentForPackage(applicationContext.packageName)?.let {
      PendingIntent.getActivity(applicationContext, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

  private fun progressNotification(batchId: String, progress: Double, count: Int): android.app.Notification {
    ensureChannel()
    val percent = (progress * 100).toInt().coerceIn(0, 100)
    return NotificationCompat.Builder(applicationContext, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(if (count > 1) "Posting your stories" else "Posting your story")
      .setContentText("$percent%")
      .setProgress(100, percent, percent == 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setContentIntent(openAppIntent())
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", WorkManager.getInstance(applicationContext).createCancelPendingIntent(id))
      .build()
  }

  private fun foregroundInfo(batchId: String, progress: Double, count: Int): ForegroundInfo {
    val notification = progressNotification(batchId, progress, count)
    return if (Build.VERSION.SDK_INT >= 29) {
      ForegroundInfo(notificationId(batchId), notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(notificationId(batchId), notification)
    }
  }

  private fun cancelProgressNotification(batchId: String) {
    runCatching { NotificationManagerCompat.from(applicationContext).cancel(notificationId(batchId)) }
  }

  /**
   * The outcome in the status bar, in the app too: "Your story was posted"
   * clears itself after a few seconds; a failure stays until opened.
   */
  private fun notifyDone(batchId: String, title: String, text: String?, ok: Boolean = false) {
    ensureChannel()
    try {
      NotificationManagerCompat.from(applicationContext).notify(
        notificationId(batchId) + 1,
        NotificationCompat.Builder(applicationContext, CHANNEL_ID)
          .setSmallIcon(if (ok) android.R.drawable.stat_sys_upload_done else android.R.drawable.stat_notify_error)
          .setContentTitle(title)
          .apply { if (text != null) setContentText(text) }
          .setSilent(ok)
          .setAutoCancel(true)
          .apply { if (ok) setTimeoutAfter(5_000L) }
          .setContentIntent(openAppIntent())
          .build(),
      )
    } catch (_: SecurityException) {
      // Notifications are off.
    }
  }
}
