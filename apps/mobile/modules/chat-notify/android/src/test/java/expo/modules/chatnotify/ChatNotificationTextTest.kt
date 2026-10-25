package expo.modules.chatnotify

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatNotificationTextTest {
  @Test fun messageBodyContainsOnlyTheNewMessage() {
    assertEquals("dfdfddf", ChatNotificationText.body("text", "dfdfddf", true))
    assertEquals("😂❤️", ChatNotificationText.body("text", "😂❤️", true))
  }

  @Test fun voiceUsesAClockDuration() {
    assertEquals("🎤 Voice message (0:05)", ChatNotificationText.body("voice", "5.64", true, seconds = 5))
    assertEquals("1:05", ChatNotificationText.duration(65))
  }

  @Test fun mediaHasALabelAndCaption() {
    assertEquals("📷 Photo · College fest ❤️", ChatNotificationText.body("photo", "College fest ❤️", true))
    assertEquals("📷 3 photos", ChatNotificationText.body("photo", null, true, count = 3))
    assertEquals("🎥 2 videos", ChatNotificationText.body("video", null, true, count = 2))
    assertEquals("🎞 GIF", ChatNotificationText.body("gif", null, true))
    assertEquals("📎 2 attachments", ChatNotificationText.body("media", null, true, count = 2))
    assertEquals("📄 Notes.pdf", ChatNotificationText.body("document", null, true, fileName = "Notes.pdf"))
  }

  @Test fun hiddenPreviewsNeverExposeSavedMessageContent() {
    assertEquals("New message", ChatNotificationText.body("text", "private text", false))
    assertEquals("📄 Document", ChatNotificationText.body("document", "private caption", false, fileName = "private.pdf"))
    assertEquals("🎤 Voice message", ChatNotificationText.body("voice", "5.64", false, seconds = 5))
    assertEquals("New reaction", ChatNotificationText.body("story_reaction", "❤️", false))
  }
}
