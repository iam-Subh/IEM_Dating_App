package expo.modules.chatnotify

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The server's notification endpoints (under /notifications/native), called with
 * the push action token (MESSAGE_NOTIFICATIONS_PLAN.md 8, 13). No JavaScript:
 * this works with the app killed.
 */
object ChatApi {
  class Refused(val status: Int, message: String) : Exception(message)

  /** POSTs JSON; returns the response's `data`. Throws Refused for 4xx (don't retry), IOException otherwise. */
  fun post(context: Context, path: String, body: JSONObject): JSONObject? {
    val base = ChatNotifyConfig.apiBase(context) ?: throw Refused(401, "Not signed in")
    val token = ChatNotifyConfig.token(context) ?: throw Refused(401, "Not signed in")
    val connection = URL("$base/notifications/native/$path").openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 10_000
      connection.readTimeout = 15_000
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty("Authorization", "PushAction $token")
      connection.setRequestProperty("ngrok-skip-browser-warning", "true")
      connection.outputStream.use { it.write(body.toString().toByteArray()) }
      val status = connection.responseCode
      val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
        ?.bufferedReader()?.use { it.readText() }.orEmpty()
      val json = runCatching { JSONObject(text) }.getOrNull()
      if (status in 400..499) throw Refused(status, json?.optString("message")?.ifEmpty { null } ?: "Not available any more")
      if (status !in 200..299) throw java.io.IOException("HTTP $status")
      return json?.optJSONObject("data")
    } finally {
      connection.disconnect()
    }
  }
}
