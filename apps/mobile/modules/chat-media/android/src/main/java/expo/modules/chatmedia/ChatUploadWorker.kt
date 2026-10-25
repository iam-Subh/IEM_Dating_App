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
import java.io.FileInputStream
import java.io.IOException

/**
 * Uploads the parts of one resumable upload, skipping parts already sent.
 *
 * Runs as a data-sync foreground service with a progress notification, the way
 * Telegram keeps a large send alive after you leave the chat. If Android stops
 * the work or the network drops, WorkManager runs it again and the parts that
 * reached S3 are not sent twice.
 */
class ChatUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  companion object {
    const val KEY_JOB_ID = "jobId"
    const val KEY_SENT = "sent"
    const val KEY_TOTAL = "total"
    const val KEY_ERROR = "error"
    private const val CHANNEL_ID = "chat_media_uploads"
    private const val MAX_RUN_ATTEMPTS = 20
    private const val PART_ATTEMPTS = 3
  }

  private var lastProgressAt = 0L
  private var lastNotificationAt = 0L

  override suspend fun getForegroundInfo(): ForegroundInfo {
    val jobId = inputData.getString(KEY_JOB_ID).orEmpty()
    val job = runCatching { ChatUploads.read(applicationContext, jobId) }.getOrNull()
    return foregroundInfo(jobId, job?.title ?: "Sending media", job?.doneBytes ?: 0L, job?.totalBytes ?: 0L)
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val jobId = inputData.getString(KEY_JOB_ID) ?: return@withContext fail("The upload is missing its id")
    val job = runCatching { ChatUploads.read(applicationContext, jobId) }.getOrNull()
      ?: return@withContext fail("The upload was cancelled")

    try {
      setForeground(foregroundInfo(jobId, job.title, job.doneBytes, job.totalBytes))
    } catch (_: IllegalStateException) {
      // Android 12+ refuses a foreground service started from the background
      // (for example a retry after the app was closed). The work still runs
      // under JobScheduler's limits, and anything unsent is resumed next run.
    }

    val descriptor = try {
      applicationContext.contentResolver.openFileDescriptor(Uri.parse(job.uri), "r")
    } catch (_: Exception) {
      null
    } ?: return@withContext fail("The file is no longer on this device")

    descriptor.use { fd ->
      FileInputStream(fd.fileDescriptor).channel.use { channel ->
        for ((number, url) in job.parts.sortedBy { it.first }) {
          if (isStopped) return@withContext Result.retry()
          if (number in job.done) continue
          val length = job.partLength(number)
          if (length <= 0) return@withContext fail("The file is shorter than when it was selected")
          var attempt = 0
          while (true) {
            try {
              PartUpload.upload(channel, (number - 1).toLong() * job.partSize, length, url, { isStopped }) { partSent ->
                report(job, job.doneBytes + partSent)
              }
              break
            } catch (error: HttpStatusException) {
              when (error.code) {
                403 -> return@withContext fail("The upload link expired. Send the file again")
                404 -> return@withContext fail("The upload was cancelled")
              }
              if (error.code in 400..499 && error.code != 408 && error.code != 429) {
                return@withContext fail("Storage rejected the upload (${error.code})")
              }
              attempt += 1
              if (attempt >= PART_ATTEMPTS || isStopped) return@withContext retryOrFail()
              delay(2_000L * attempt)
            } catch (error: IOException) {
              attempt += 1
              if (attempt >= PART_ATTEMPTS || isStopped) return@withContext retryOrFail()
              delay(2_000L * attempt)
            }
          }
          job.done.add(number)
          ChatUploads.save(applicationContext, job)
          report(job, job.doneBytes, force = true)
        }
      }
    }
    Result.success(workDataOf(KEY_SENT to job.totalBytes, KEY_TOTAL to job.totalBytes))
  }

  private fun retryOrFail(): Result =
    if (runAttemptCount + 1 >= MAX_RUN_ATTEMPTS) fail("The upload kept failing. Check your connection and retry")
    else Result.retry()

  private fun fail(message: String): Result = Result.failure(workDataOf(KEY_ERROR to message))

  private fun report(job: UploadJob, sent: Long, force: Boolean = false) {
    val now = System.currentTimeMillis()
    if (!force && now - lastProgressAt < 250) return
    lastProgressAt = now
    UploadProgressBus.emit(job.jobId, sent, job.totalBytes)
    setProgressAsync(workDataOf(KEY_SENT to sent, KEY_TOTAL to job.totalBytes))
    if (force || now - lastNotificationAt >= 1_000) {
      lastNotificationAt = now
      try {
        NotificationManagerCompat.from(applicationContext)
          .notify(notificationId(job.jobId), notification(job.jobId, job.title, sent, job.totalBytes))
      } catch (_: SecurityException) {
        // Notifications are off; the upload continues without a visible bar.
      }
    }
  }

  private fun notificationId(jobId: String) = 0x4000_0000 or (jobId.hashCode() and 0x3FFF_FFFF)

  private fun foregroundInfo(jobId: String, title: String, sent: Long, total: Long): ForegroundInfo {
    val notification = notification(jobId, title, sent, total)
    return if (Build.VERSION.SDK_INT >= 29) {
      ForegroundInfo(notificationId(jobId), notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(notificationId(jobId), notification)
    }
  }

  private fun notification(jobId: String, title: String, sent: Long, total: Long): android.app.Notification {
    val context = applicationContext
    if (Build.VERSION.SDK_INT >= 26) {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Media uploads", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Progress of photos and videos you are sending"
          setShowBadge(false)
        })
      }
    }
    val percent = if (total > 0) ((sent * 100) / total).toInt().coerceIn(0, 100) else 0
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(title)
      .setContentText(if (total > 0) "${formatBytes(sent)} of ${formatBytes(total)}" else "Preparing")
      .setProgress(100, percent, total <= 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setContentIntent(open)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", WorkManager.getInstance(context).createCancelPendingIntent(id))
      .build()
  }

  private fun formatBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024 * 1024 -> String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024))
    bytes >= 1024L * 1024 -> String.format("%.1f MB", bytes / (1024.0 * 1024))
    bytes >= 1024 -> String.format("%.0f KB", bytes / 1024.0)
    else -> "$bytes B"
  }
}
