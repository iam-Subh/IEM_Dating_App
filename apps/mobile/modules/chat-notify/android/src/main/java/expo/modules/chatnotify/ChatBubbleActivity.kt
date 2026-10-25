package expo.modules.chatnotify

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * A chat in a bubble - the floating chat head (MESSAGE_NOTIFICATIONS_PLAN.md 12).
 * Android shows this screen inside the bubble; it runs the app's "ChatBubble"
 * root (index.ts), which is just the one chat.
 */
class ChatBubbleActivity : ReactActivity() {
  override fun getMainComponentName(): String = "ChatBubble"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      override fun getLaunchOptions(): Bundle = Bundle().apply {
        putString("matchId", intent?.data?.lastPathSegment ?: intent?.getStringExtra(ChatNotifier.EXTRA_MATCH))
        putString("title", intent?.getStringExtra("title"))
      }
    }
}
