package expo.modules.chatmedia

import android.content.Context
import android.net.Uri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit

/** Delivers upload progress from the worker to whichever module instance is alive. */
object UploadProgressBus {
  private val listeners = CopyOnWriteArraySet<(String, Long, Long) -> Unit>()

  fun subscribe(listener: (String, Long, Long) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun emit(jobId: String, sent: Long, total: Long) {
    listeners.forEach { runCatching { it(jobId, sent, total) } }
  }
}

/**
 * A resumable upload, persisted so it survives the process.
 *
 * Every part URL is presigned by the server up front: the worker may run long
 * after the app's access token has expired, or in a process where JavaScript
 * never started, so it must not need to call the API.
 */
class UploadJob(
  val jobId: String,
  val uri: String,
  val partSize: Long,
  val totalBytes: Long,
  val title: String,
  val parts: List<Pair<Int, String>>,
  val done: MutableSet<Int>,
) {
  val doneBytes: Long
    get() = done.sumOf { number -> partLength(number) }

  fun partLength(number: Int): Long {
    val offset = (number - 1).toLong() * partSize
    return (totalBytes - offset).coerceIn(0, partSize)
  }

  fun toJson(): JSONObject = JSONObject()
    .put("jobId", jobId)
    .put("uri", uri)
    .put("partSize", partSize)
    .put("totalBytes", totalBytes)
    .put("title", title)
    .put("parts", JSONArray(parts.map { JSONObject().put("partNumber", it.first).put("url", it.second) }))
    .put("done", JSONArray(done.sorted()))

  companion object {
    fun fromJson(json: JSONObject): UploadJob {
      val parts = json.getJSONArray("parts")
      val done = json.getJSONArray("done")
      return UploadJob(
        jobId = json.getString("jobId"),
        uri = json.getString("uri"),
        partSize = json.getLong("partSize"),
        totalBytes = json.getLong("totalBytes"),
        title = json.optString("title", "Sending media"),
        parts = (0 until parts.length()).map { parts.getJSONObject(it).let { part -> part.getInt("partNumber") to part.getString("url") } },
        done = (0 until done.length()).map { done.getInt(it) }.toMutableSet(),
      )
    }
  }
}

object ChatUploads {
  private val JOB_ID = Regex("^[A-Za-z0-9_-]{1,64}$")
  private val lock = Any()

  private fun directory(context: Context) = File(context.filesDir, "chat-uploads").apply { mkdirs() }

  private fun fileFor(context: Context, jobId: String): File {
    require(JOB_ID.matches(jobId)) { "Invalid upload id" }
    return File(directory(context), "$jobId.json")
  }

  fun workName(jobId: String) = "chat-upload-$jobId"

  fun read(context: Context, jobId: String): UploadJob? = synchronized(lock) {
    val file = fileFor(context, jobId)
    if (!file.exists()) return null
    runCatching { UploadJob.fromJson(JSONObject(file.readText())) }.getOrNull()
  }

  fun save(context: Context, job: UploadJob) = synchronized(lock) {
    val file = fileFor(context, job.jobId)
    val temp = File(file.parentFile, "${file.name}.tmp")
    temp.writeText(job.toJson().toString())
    if (!temp.renameTo(file)) {
      file.delete()
      temp.renameTo(file)
    }
  }

  private fun sizeOf(context: Context, uri: String): Long {
    val parsed = Uri.parse(uri)
    val size = if (parsed.scheme == null) File(uri).length()
    else context.contentResolver.openFileDescriptor(parsed, "r")?.use { it.statSize } ?: -1L
    require(size > 0) { "The file is empty or unavailable" }
    return size
  }

  fun enqueue(context: Context, options: UploadOptions) {
    val existing = read(context, options.jobId)
    if (existing == null) {
      val partSize = options.partSize.toLong()
      require(partSize > 0 && options.parts.isNotEmpty()) { "The upload has no parts" }
      val total = sizeOf(context, options.uri)
      val expectedParts = ((total + partSize - 1) / partSize).toInt()
      require(expectedParts == options.parts.size) {
        "The file is $total bytes but the upload was prepared for ${options.parts.size} parts"
      }
      save(context, UploadJob(
        jobId = options.jobId,
        uri = options.uri,
        partSize = partSize,
        totalBytes = total,
        title = options.title,
        parts = options.parts.map { it.partNumber to it.url },
        done = mutableSetOf(),
      ))
    }
    val request = OneTimeWorkRequestBuilder<ChatUploadWorker>()
      .setInputData(workDataOf(ChatUploadWorker.KEY_JOB_ID to options.jobId))
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
      .addTag("chat-upload")
      .build()
    // KEEP leaves a running upload alone, and replaces one that already
    // finished or failed, so calling this again is also how a retry happens.
    WorkManager.getInstance(context).enqueueUniqueWork(workName(options.jobId), ExistingWorkPolicy.KEEP, request)
  }

  fun status(context: Context, jobId: String): Map<String, Any?> {
    val job = read(context, jobId)
    val info = WorkManager.getInstance(context).getWorkInfosForUniqueWork(workName(jobId)).get().lastOrNull()
    val total = job?.totalBytes ?: 0L
    val complete = job != null && job.done.size == job.parts.size
    val sent = maxOf(job?.doneBytes ?: 0L, info?.progress?.getLong(ChatUploadWorker.KEY_SENT, 0L) ?: 0L)
    val state = when (info?.state) {
      WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
      WorkInfo.State.RUNNING -> "running"
      WorkInfo.State.SUCCEEDED -> "succeeded"
      WorkInfo.State.FAILED -> "failed"
      WorkInfo.State.CANCELLED -> "cancelled"
      // Finished work is pruned after about a day; the job file still knows.
      null -> if (complete) "succeeded" else if (job != null) "interrupted" else "unknown"
    }
    return mapOf(
      "state" to state,
      "bytesSent" to (if (complete) total else sent).toDouble(),
      "totalBytes" to total.toDouble(),
      "error" to info?.outputData?.getString(ChatUploadWorker.KEY_ERROR),
    )
  }

  fun cancel(context: Context, jobId: String) {
    WorkManager.getInstance(context).cancelUniqueWork(workName(jobId)).result.get()
    synchronized(lock) { fileFor(context, jobId).delete() }
  }

  fun forget(context: Context, jobId: String) {
    synchronized(lock) { fileFor(context, jobId).delete() }
    WorkManager.getInstance(context).pruneWork()
  }
}
