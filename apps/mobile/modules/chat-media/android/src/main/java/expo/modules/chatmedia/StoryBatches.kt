package expo.modules.chatmedia

import android.content.Context
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

/** Delivers story posting progress from the worker to whichever module instance is alive. */
object StoryBatchProgressBus {
  private val listeners = CopyOnWriteArraySet<(Map<String, Any?>) -> Unit>()

  fun subscribe(listener: (Map<String, Any?>) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun emit(event: Map<String, Any?>) {
    listeners.forEach { runCatching { it(event) } }
  }
}

/**
 * One story of a batch as the worker sees it.
 *
 * A photo arrives rendered by the app. A video arrives as its source plus what
 * the editor did to it (trim, mute, filter, placement, background, decorative
 * overlay, music), and is exported here, in the background, before upload.
 */
class StoryItemJob(
  val itemId: String,
  val kind: String,
  val sourceUri: String,
  val clipStartMs: Long?,
  val clipEndMs: Long?,
  val muted: Boolean,
  val filter: JSONObject?,
  val transform: JSONObject?,
  val fitMode: String,
  val background: List<String>,
  val overlayUri: String?,
  val music: JSONObject?,
  var exportedUri: String?,
  var status: String,
  var partSize: Long,
  val parts: MutableList<Pair<Int, String>>,
  val done: MutableSet<Int>,
  var totalBytes: Long,
  var storyJson: String?,
  var error: String?,
  var needsRestart: Boolean,
) {
  fun partLength(number: Int): Long {
    val offset = (number - 1).toLong() * partSize
    return (totalBytes - offset).coerceIn(0, partSize)
  }

  val doneBytes: Long
    get() = done.sumOf { partLength(it) }

  fun toJson(): JSONObject = JSONObject()
    .put("itemId", itemId)
    .put("kind", kind)
    .put("sourceUri", sourceUri)
    .put("clipStartMs", clipStartMs ?: JSONObject.NULL)
    .put("clipEndMs", clipEndMs ?: JSONObject.NULL)
    .put("muted", muted)
    .put("filter", filter ?: JSONObject.NULL)
    .put("transform", transform ?: JSONObject.NULL)
    .put("fitMode", fitMode)
    .put("background", JSONArray(background))
    .put("overlayUri", overlayUri ?: JSONObject.NULL)
    .put("music", music ?: JSONObject.NULL)
    .put("exportedUri", exportedUri ?: JSONObject.NULL)
    .put("status", status)
    .put("partSize", partSize)
    .put("parts", JSONArray(parts.map { JSONObject().put("partNumber", it.first).put("url", it.second) }))
    .put("done", JSONArray(done.sorted()))
    .put("totalBytes", totalBytes)
    .put("storyJson", storyJson ?: JSONObject.NULL)
    .put("error", error ?: JSONObject.NULL)
    .put("needsRestart", needsRestart)

  companion object {
    private fun JSONObject.longOrNull(key: String) = if (isNull(key) || !has(key)) null else getLong(key)
    private fun JSONObject.stringOrNull(key: String) = if (isNull(key) || !has(key)) null else getString(key)
    private fun JSONObject.objectOrNull(key: String) = if (isNull(key) || !has(key)) null else getJSONObject(key)

    fun fromJson(json: JSONObject): StoryItemJob {
      val parts = json.optJSONArray("parts") ?: JSONArray()
      val done = json.optJSONArray("done") ?: JSONArray()
      val background = json.optJSONArray("background") ?: JSONArray()
      return StoryItemJob(
        itemId = json.getString("itemId"),
        kind = json.getString("kind"),
        sourceUri = json.getString("sourceUri"),
        clipStartMs = json.longOrNull("clipStartMs"),
        clipEndMs = json.longOrNull("clipEndMs"),
        muted = json.optBoolean("muted", false),
        filter = json.objectOrNull("filter"),
        transform = json.objectOrNull("transform"),
        fitMode = json.optString("fitMode", "cover"),
        background = (0 until background.length()).map { background.getString(it) },
        overlayUri = json.stringOrNull("overlayUri"),
        music = json.objectOrNull("music"),
        exportedUri = json.stringOrNull("exportedUri"),
        status = json.optString("status", "pending"),
        partSize = json.optLong("partSize", 0L),
        parts = (0 until parts.length()).map { parts.getJSONObject(it).let { part -> part.getInt("partNumber") to part.getString("url") } }.toMutableList(),
        done = (0 until done.length()).map { done.getInt(it) }.toMutableSet(),
        totalBytes = json.optLong("totalBytes", 0L),
        storyJson = json.stringOrNull("storyJson"),
        error = json.stringOrNull("error"),
        needsRestart = json.optBoolean("needsRestart", false),
      )
    }
  }
}

class StoryBatchJob(
  val batchId: String,
  val apiBaseUrl: String,
  val publishToken: String,
  val title: String,
  val items: List<StoryItemJob>,
  var status: String,
  var error: String?,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("batchId", batchId)
    .put("apiBaseUrl", apiBaseUrl)
    .put("publishToken", publishToken)
    .put("title", title)
    .put("items", JSONArray(items.map { it.toJson() }))
    .put("status", status)
    .put("error", error ?: JSONObject.NULL)

  companion object {
    fun fromJson(json: JSONObject): StoryBatchJob {
      val items = json.getJSONArray("items")
      return StoryBatchJob(
        batchId = json.getString("batchId"),
        apiBaseUrl = json.getString("apiBaseUrl"),
        publishToken = json.getString("publishToken"),
        title = json.optString("title", "Posting your story"),
        items = (0 until items.length()).map { StoryItemJob.fromJson(items.getJSONObject(it)) },
        status = json.optString("status", "posting"),
        error = if (json.isNull("error")) null else json.optString("error"),
      )
    }
  }
}

object StoryBatches {
  private val BATCH_ID = Regex("^[A-Za-z0-9_-]{1,64}$")
  private val lock = Any()
  private val TERMINAL_ITEM = setOf("published", "rejected", "cancelled")

  private fun directory(context: Context) = File(context.filesDir, "story-batches").apply { mkdirs() }

  private fun fileFor(context: Context, batchId: String): File {
    require(BATCH_ID.matches(batchId)) { "Invalid batch id" }
    return File(directory(context), "$batchId.json")
  }

  /** Where a batch's exported videos live until it has posted. */
  fun outputDir(context: Context, batchId: String): File {
    require(BATCH_ID.matches(batchId)) { "Invalid batch id" }
    return File(directory(context), batchId).apply { mkdirs() }
  }

  fun workName(batchId: String) = "story-batch-$batchId"

  fun read(context: Context, batchId: String): StoryBatchJob? = synchronized(lock) {
    val file = fileFor(context, batchId)
    if (!file.exists()) return null
    runCatching { StoryBatchJob.fromJson(JSONObject(file.readText())) }.getOrNull()
  }

  fun save(context: Context, job: StoryBatchJob) = synchronized(lock) {
    val file = fileFor(context, job.batchId)
    val temp = File(file.parentFile, "${file.name}.tmp")
    temp.writeText(job.toJson().toString())
    if (!temp.renameTo(file)) {
      file.delete()
      temp.renameTo(file)
    }
  }

  fun enqueue(context: Context, record: StoryBatchRecord) {
    if (read(context, record.batchId) == null) {
      require(record.items.isNotEmpty()) { "The batch has no stories" }
      save(context, StoryBatchJob(
        batchId = record.batchId,
        apiBaseUrl = record.apiBaseUrl.trimEnd('/'),
        publishToken = record.publishToken,
        title = record.title,
        items = record.items.map { item -> storyItemJobOf(item) },
        status = "posting",
        error = null,
      ))
    }
    start(context, record.batchId, ExistingWorkPolicy.KEEP)
  }

  private fun start(context: Context, batchId: String, policy: ExistingWorkPolicy) {
    val request = OneTimeWorkRequestBuilder<StoryBatchWorker>()
      .setInputData(workDataOf(StoryBatchWorker.KEY_BATCH_ID to batchId))
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
      .addTag("story-batch")
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(workName(batchId), policy, request)
  }

  /** Try again after a failure: stories that could not post locally get another go; posted ones are skipped. */
  fun retry(context: Context, batchId: String) {
    val job = read(context, batchId) ?: throw IllegalStateException("This post is no longer on this device")
    if (job.status == "cancelled") throw IllegalStateException("This post was cancelled")
    job.items.forEach { item -> if (item.status == "failed") { item.status = "pending"; item.error = null } }
    job.status = "posting"
    job.error = null
    save(context, job)
    start(context, batchId, ExistingWorkPolicy.REPLACE)
  }

  fun status(context: Context, batchId: String): Map<String, Any?>? {
    val job = read(context, batchId) ?: return null
    val info = WorkManager.getInstance(context).getWorkInfosForUniqueWork(workName(batchId)).get().lastOrNull()
    val workState = when (info?.state) {
      WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
      WorkInfo.State.RUNNING -> "running"
      WorkInfo.State.SUCCEEDED -> "succeeded"
      WorkInfo.State.FAILED -> "failed"
      WorkInfo.State.CANCELLED -> "cancelled"
      null -> "unknown"
    }
    val total = job.items.size.coerceAtLeast(1)
    val progress = job.items.sumOf { item ->
      when {
        item.status in TERMINAL_ITEM -> 1.0
        item.totalBytes > 0 -> 0.35 + 0.6 * item.doneBytes / item.totalBytes
        item.exportedUri != null -> 0.35
        else -> 0.0
      }
    } / total
    return mapOf(
      "batchId" to job.batchId,
      "status" to job.status,
      "workState" to workState,
      "error" to job.error,
      "progress" to progress,
      "items" to job.items.map { item ->
        mapOf("itemId" to item.itemId, "status" to item.status, "error" to item.error, "story" to item.storyJson)
      },
    )
  }

  fun list(context: Context): List<Map<String, Any?>> =
    directory(context).listFiles { file -> file.isFile && file.name.endsWith(".json") }
      ?.mapNotNull { runCatching { status(context, it.name.removeSuffix(".json")) }.getOrNull() }
      ?: emptyList()

  fun cancel(context: Context, batchId: String) {
    WorkManager.getInstance(context).cancelUniqueWork(workName(batchId)).result.get()
    val job = read(context, batchId) ?: return
    job.status = "cancelled"
    job.items.forEach { item -> if (item.status !in TERMINAL_ITEM) item.status = "cancelled" }
    save(context, job)
    outputDir(context, batchId).deleteRecursively()
  }

  fun forget(context: Context, batchId: String) {
    synchronized(lock) { fileFor(context, batchId).delete() }
    outputDir(context, batchId).deleteRecursively()
    WorkManager.getInstance(context).pruneWork()
  }
}
