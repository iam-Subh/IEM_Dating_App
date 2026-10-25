package expo.modules.chatnotify

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Opens an encrypted chat push (MESSAGE_NOTIFICATIONS_PLAN.md 11):
 * `{ type: "enc", iv, ct }`, AES-256-GCM with this phone's own key; `ct` is the
 * ciphertext followed by the 16-byte tag (what Java's GCM expects).
 */
object PushCrypto {
  fun open(context: Context, data: JSONObject): JSONObject? = runCatching {
    val key = ChatNotifyConfig.pushKeyBytes(context) ?: return null
    val iv = Base64.decode(data.getString("iv"), Base64.DEFAULT)
    val body = Base64.decode(data.getString("ct"), Base64.DEFAULT)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    JSONObject(String(cipher.doFinal(body), Charsets.UTF_8))
  }.getOrNull()
}
