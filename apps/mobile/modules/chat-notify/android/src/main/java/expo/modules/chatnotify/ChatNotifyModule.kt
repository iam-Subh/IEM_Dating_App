package expo.modules.chatnotify

import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

/**
 * The app's side of chat notifications (MESSAGE_NOTIFICATIONS_PLAN.md):
 * signs the native code in and out, tells it what is on screen, clears a chat
 * when it is opened or ends - and the extras: the push key, shared content
 * from other apps, chat shortcuts, and raise to ear.
 */
class ChatNotifyModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private val background = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("ChatNotify")

    Events("onShare", "onProximity", "onEarpieceEnded")

    /** After login and push registration: the API address, the account, its push action token. */
    Function("setSession") { apiBase: String, token: String, userId: String ->
      val previous = ChatNotifyConfig.userId(context)
      // Another account on this phone: nothing of the last one stays.
      if (previous != null && previous != userId) ChatNotifier.forgetAll(context)
      ChatNotifyConfig.save(context, apiBase, token, userId)
    }

    /** Logout: everything goes - notifications, chat shortcuts, pictures, the token, the push key. */
    Function("clearSession") {
      ChatNotifier.forgetAll(context)
      ChatNotifyConfig.clear(context)
    }

    /** This phone's key for encrypted chat pushes, made on first use (section 11). */
    Function("pushKey") { ChatNotifyConfig.pushKey(context) }

    /** What is on screen: no notification for the open chat; none at all with in-app banners off. */
    Function("setAppState") { foreground: Boolean, activeMatchId: String?, bannersEnabled: Boolean ->
      ChatNotifyConfig.appForeground = foreground
      ChatNotifyConfig.activeMatchId = activeMatchId
      ChatNotifyConfig.bannersEnabled = bannersEnabled
    }

    /** Opened, read, muted, unmatched or blocked: its notification and lines go. */
    Function("clearChat") { matchId: String, removeShortcut: Boolean ->
      ChatNotifier.forget(context, matchId, endBubble = removeShortcut)
      if (removeShortcut) ChatNotifier.removeShortcut(context, matchId)
    }

    /** A chat was opened in the app: its shortcut, for the Conversations section and the share sheet (section 12). */
    Function("reportChat") { matchId: String, name: String, avatarUrl: String? ->
      background.execute {
        val avatar = MediaFetcher.avatar(context, avatarUrl)
        ChatNotifier.publishShortcut(context, matchId, name, avatar)
      }
    }

    /** Something shared from another app, once: { matchId?, text?, file?, mimeType? } (section 12). */
    Function("takeShare") {
      ShareIntake.capture(context, appContext.currentActivity?.intent)
      ShareIntake.take()?.let { bundleOf("matchId" to it.matchId, "text" to it.text, "file" to it.file, "mimeType" to it.mimeType) }
    }

    OnNewIntent { intent ->
      if (ShareIntake.capture(context, intent)) sendEvent("onShare", bundleOf())
    }

    // --- Raise to ear (section 7) ---

    /** Watches the proximity sensor while a voice message plays. False if the phone has none. */
    Function("startProximity") {
      Earpiece.watch(context) { near -> sendEvent("onProximity", bundleOf("near" to near)) }
    }

    Function("stopProximity") { Earpiece.stopWatching(context) }

    /** Continues a voice message through the earpiece from `positionMs`. */
    Function("playEarpiece") { uri: String, positionMs: Double, rate: Double ->
      Earpiece.play(context, uri, positionMs.toLong(), rate.toFloat()) { sendEvent("onEarpieceEnded", bundleOf()) }
    }

    /** Stops the earpiece; returns the position, in ms, for the speaker to continue from. */
    Function("stopEarpiece") { Earpiece.stop(context).toDouble() }

    OnDestroy {
      Earpiece.stopWatching(context)
      background.shutdown()
    }
  }
}
