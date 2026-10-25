package expo.modules.chattimeline

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/** A per-account disk store. The native list reads this before network sync. */
internal class ChatMessageStore(context: Context) : SQLiteOpenHelper(context, "chat-timeline.db", null, 1) {
  companion object {
    @Volatile private var instance: ChatMessageStore? = null

    fun get(context: Context): ChatMessageStore = instance ?: synchronized(this) {
      instance ?: ChatMessageStore(context.applicationContext).also { instance = it }
    }
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE messages (
        account_id TEXT NOT NULL,
        match_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        sequence_number INTEGER,
        body TEXT NOT NULL,
        PRIMARY KEY (account_id, match_id, message_id)
      )
    """.trimIndent())
    db.execSQL("CREATE INDEX messages_order ON messages(account_id, match_id, sent_at DESC, message_id DESC)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  @Synchronized fun upsert(accountId: String, matchId: String, serialized: String) {
    if (accountId.isBlank() || matchId.isBlank()) return
    val rows = JSONArray(serialized)
    val db = writableDatabase
    db.beginTransaction()
    try {
      for (index in 0 until rows.length()) {
        val row = rows.optJSONObject(index) ?: continue
        val id = row.optString("id")
        if (id.isBlank()) continue
        val values = ContentValues().apply {
          put("account_id", accountId)
          put("match_id", matchId)
          put("message_id", id)
          put("sent_at", row.optString("sentAt"))
          if (!row.isNull("messageSeq")) put("sequence_number", row.optLong("messageSeq"))
          put("body", row.toString())
        }
        db.insertWithOnConflict("messages", null, values, SQLiteDatabase.CONFLICT_REPLACE)
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  @Synchronized fun latest(accountId: String, matchId: String, limit: Int): String {
    val result = JSONArray()
    if (accountId.isBlank() || matchId.isBlank()) return result.toString()
    readableDatabase.query(
      "messages", arrayOf("body"), "account_id = ? AND match_id = ?",
      arrayOf(accountId, matchId), null, null,
      "sent_at DESC, message_id DESC", limit.coerceIn(1, 200).toString(),
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val row = JSONObject(cursor.getString(0))
        val expiry = row.optString("expiresAt")
        if (expiry.isNotBlank()) {
          val expiresAt = runCatching { java.time.Instant.parse(expiry).toEpochMilli() }.getOrNull()
          if (expiresAt != null && expiresAt <= System.currentTimeMillis()) continue
        }
        result.put(row)
      }
    }
    return result.toString()
  }

  @Synchronized fun deleteMessages(accountId: String, matchId: String, ids: List<String>) {
    if (accountId.isBlank() || matchId.isBlank() || ids.isEmpty()) return
    val db = writableDatabase
    db.beginTransaction()
    try {
      ids.forEach { id ->
        db.delete("messages", "account_id = ? AND match_id = ? AND message_id = ?", arrayOf(accountId, matchId, id))
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  @Synchronized fun clearMatch(accountId: String, matchId: String) {
    if (accountId.isNotBlank() && matchId.isNotBlank()) {
      writableDatabase.delete("messages", "account_id = ? AND match_id = ?", arrayOf(accountId, matchId))
    }
  }

  @Synchronized fun clearAccount(accountId: String) {
    if (accountId.isNotBlank()) writableDatabase.delete("messages", "account_id = ?", arrayOf(accountId))
  }
}
