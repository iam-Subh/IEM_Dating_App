package expo.modules.chatnotify

import android.content.Context
import android.content.SharedPreferences

/**
 * What the native notification code needs to act with the app closed
 * (MESSAGE_NOTIFICATIONS_PLAN.md, decisions): the API address, the signed-in
 * account, and its push action token - a narrow token that only works for
 * notification actions and dies with logout. Saved by the app (ChatNotifyModule).
 *
 * Whether the app is on screen lives in memory only: if the process dies,
 * the app is not on screen, and the value correctly resets.
 */
object ChatNotifyConfig {
  private const val PREFS = "chat_notify_config"

  @Volatile var appForeground = false
  @Volatile var activeMatchId: String? = null
  @Volatile var bannersEnabled = true

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun save(context: Context, apiBase: String, token: String, userId: String) {
    prefs(context).edit()
      .putString("apiBase", apiBase.trimEnd('/'))
      .putString("token", token)
      .putString("userId", userId)
      .apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  /**
   * This phone's key for encrypted chat pushes (MESSAGE_NOTIFICATIONS_PLAN.md 11):
   * 32 random bytes, made once, given to the server over HTTPS at registration.
   * Logging out clears it, so the next account gets a new one.
   */
  fun pushKey(context: Context): String = synchronized(this) {
    prefs(context).getString("pushKey", null) ?: run {
      val bytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
      val key = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
      prefs(context).edit().putString("pushKey", key).apply()
      key
    }
  }

  fun pushKeyBytes(context: Context): ByteArray? =
    prefs(context).getString("pushKey", null)?.let { android.util.Base64.decode(it, android.util.Base64.NO_WRAP) }

  fun apiBase(context: Context): String? = prefs(context).getString("apiBase", null)
  fun token(context: Context): String? = prefs(context).getString("token", null)
  fun userId(context: Context): String? = prefs(context).getString("userId", null)
}
