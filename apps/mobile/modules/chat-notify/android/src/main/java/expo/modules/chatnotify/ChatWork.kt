package expo.modules.chatnotify

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * The notification actions' network calls (MESSAGE_NOTIFICATIONS_PLAN.md 8,
 * 13): queued in WorkManager, so they survive no network, Doze and the app
 * being killed. A refusal (blocked, unmatched, the message limit) is shown in
 * the notification; a network failure is retried, for up to a day.
 */
object ChatWork {
  private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

  fun reply(context: Context, matchId: String, text: String, clientId: String) = enqueue(
    context, "chat-reply-$clientId",
    OneTimeWorkRequestBuilder<ReplyWorker>()
      .setInputData(workDataOf("matchId" to matchId, "text" to text, "clientId" to clientId, "queuedAt" to System.currentTimeMillis())),
  )

  fun read(context: Context, matchId: String) = enqueue(
    context, "chat-read-$matchId",
    OneTimeWorkRequestBuilder<CallWorker>().setInputData(workDataOf("path" to "read", "body" to JSONObject().put("matchId", matchId).toString())),
  )

  fun delivered(context: Context, matchId: String, messageId: String) = enqueue(
    context, "chat-delivered-$messageId",
    OneTimeWorkRequestBuilder<CallWorker>().setInputData(workDataOf(
      "path" to "delivered",
      "body" to JSONObject().put("matchId", matchId).put("messageIds", JSONArray().put(messageId)).toString(),
    )),
  )

  fun played(context: Context, matchId: String, messageId: String) = enqueue(
    context, "chat-played-$messageId",
    OneTimeWorkRequestBuilder<CallWorker>().setInputData(workDataOf(
      "path" to "played",
      "body" to JSONObject().put("matchId", matchId).put("messageId", messageId).toString(),
    )),
  )

  fun opened(context: Context, pushId: String, action: String) = enqueue(
    context, "chat-opened-$pushId",
    OneTimeWorkRequestBuilder<CallWorker>().setInputData(workDataOf(
      "path" to "opened",
      "body" to JSONObject().put("pushId", pushId).put("action", action).toString(),
    )),
  )

  /** Redraw every chat at `at` - a disappearing message expires then (section 9). */
  fun redrawAt(context: Context, at: Long) {
    val delay = (at - System.currentTimeMillis()).coerceAtLeast(0)
    WorkManager.getInstance(context).enqueueUniqueWork(
      "chat-redraw", ExistingWorkPolicy.REPLACE,
      OneTimeWorkRequestBuilder<RedrawWorker>().setInitialDelay(delay + 500, TimeUnit.MILLISECONDS).build(),
    )
  }

  private fun enqueue(context: Context, name: String, builder: OneTimeWorkRequest.Builder) {
    val request = builder.setConstraints(online).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS).build()
    WorkManager.getInstance(context).enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)
  }
}

private const val GIVE_UP_MS = 24L * 60 * 60 * 1000

/** One call; retried on network errors for up to a day. */
class CallWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val path = inputData.getString("path") ?: return Result.failure()
    val body = inputData.getString("body")?.let { JSONObject(it) } ?: return Result.failure()
    return try {
      ChatApi.post(applicationContext, path, body)
      Result.success()
    } catch (refused: ChatApi.Refused) {
      Result.failure()
    } catch (error: Exception) {
      if (runAttemptCount > 40) Result.failure() else Result.retry()
    }
  }
}

/** A reply from the notification: "Sending…" until the server has it (section 8). */
class ReplyWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val matchId = inputData.getString("matchId") ?: return Result.failure()
    val text = inputData.getString("text") ?: return Result.failure()
    val clientId = inputData.getString("clientId") ?: return Result.failure()
    val localId = "local:$clientId"
    return try {
      ChatApi.post(applicationContext, "reply", JSONObject().put("matchId", matchId).put("text", text).put("clientMessageId", clientId))
      // Sent: replying also read the chat, so only "You: …" stays, until opened or swiped.
      ChatStore.update(applicationContext, matchId) { current ->
        current?.copy(lines = current.lines.filter { it.self }.map { if (it.id == localId) it.copy(sending = false) else it }, hidden = 0)
      }
      ChatNotifier.show(applicationContext, matchId, alert = false)
      Result.success()
    } catch (refused: ChatApi.Refused) {
      mark(matchId, localId, refused.message ?: "Not sent")
      Result.failure()
    } catch (error: Exception) {
      val waited = System.currentTimeMillis() - (inputData.getLong("queuedAt", 0).takeIf { it > 0 } ?: System.currentTimeMillis())
      if (runAttemptCount > 60 || waited > GIVE_UP_MS) {
        mark(matchId, localId, "Not sent - open the chat to retry")
        Result.failure()
      } else Result.retry()
    }
  }

  private fun mark(matchId: String, localId: String, reason: String) {
    ChatStore.update(applicationContext, matchId) { current ->
      current?.copy(lines = current.lines.map { if (it.id == localId) it.copy(sending = false, failed = reason) else it })
    }
    ChatNotifier.show(applicationContext, matchId, alert = false)
  }
}

class RedrawWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    ChatStore.all(applicationContext).forEach { ChatNotifier.show(applicationContext, it.matchId, alert = false) }
    return Result.success()
  }
}
