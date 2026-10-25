package expo.modules.chatnotify

/** Text for Android's conversation template. Sender names belong to Person, not the body. */
object ChatNotificationText {
  fun duration(seconds: Int): String {
    val total = seconds.coerceAtLeast(0)
    return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
  }

  fun hidden(kind: String): String = when (kind) {
    "voice" -> "🎤 Voice message"
    "photo" -> "📷 Photo"
    "video" -> "🎥 Video"
    "gif" -> "🎞 GIF"
    "media" -> "📎 Attachment"
    "document" -> "📄 Document"
    "reaction", "story_reaction" -> "New reaction"
    "story_reply" -> "Replied to your story"
    else -> "New message"
  }

  fun body(kind: String, text: String?, previews: Boolean, count: Int = 1, seconds: Int? = null, fileName: String? = null): String {
    if (!previews) return hidden(kind)
    val caption = text?.trim()?.takeIf { it.isNotEmpty() }
    val total = count.coerceAtLeast(1)
    val label = when (kind) {
      "photo" -> if (total > 1) "📷 $total photos" else "📷 Photo"
      "video" -> if (total > 1) "🎥 $total videos" else "🎥 Video"
      "gif" -> "🎞 GIF"
      "media" -> if (total > 1) "📎 $total attachments" else "📎 Attachment"
      "document" -> "📄 ${fileName?.takeIf { it.isNotBlank() } ?: "Document"}"
      "voice" -> "🎤 Voice message${seconds?.let { " (${duration(it)})" } ?: ""}"
      "story_reaction" -> return caption?.let { "Reacted $it to your story" } ?: "Reacted to your story"
      "story_reply" -> return "Replied to your story${caption?.let { ": $it" } ?: ""}"
      else -> return caption ?: "New message"
    }
    return if (kind == "voice") label else label + (caption?.let { " · $it" } ?: "")
  }
}
