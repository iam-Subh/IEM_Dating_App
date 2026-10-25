package expo.modules.chatmedia

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

class HttpStatusException(val code: Int, message: String) : IOException(message)

/** One part of an S3 multipart upload, streamed from a file to its presigned URL. */
object PartUpload {
  fun upload(
    channel: FileChannel,
    offset: Long,
    length: Long,
    url: String,
    isStopped: () -> Boolean,
    onProgress: (Long) -> Unit,
  ) {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "PUT"
      doOutput = true
      connectTimeout = 30_000
      readTimeout = 120_000
      setFixedLengthStreamingMode(length)
    }
    try {
      val bytes = ByteArray(64 * 1024)
      val buffer = ByteBuffer.wrap(bytes)
      var sent = 0L
      connection.outputStream.use { output ->
        while (sent < length) {
          if (isStopped()) throw IOException("Upload stopped")
          buffer.clear()
          buffer.limit(minOf(bytes.size.toLong(), length - sent).toInt())
          val read = channel.read(buffer, offset + sent)
          if (read <= 0) throw IOException("The file ended early")
          output.write(bytes, 0, read)
          sent += read
          onProgress(sent)
        }
      }
      val code = connection.responseCode
      if (code !in 200..299) {
        val detail = runCatching { connection.errorStream?.bufferedReader()?.use { it.readText() } }.getOrNull()?.take(300)
        throw HttpStatusException(code, "Part upload failed with HTTP $code${detail?.let { ": $it" } ?: ""}")
      }
    } finally {
      connection.disconnect()
    }
  }
}
