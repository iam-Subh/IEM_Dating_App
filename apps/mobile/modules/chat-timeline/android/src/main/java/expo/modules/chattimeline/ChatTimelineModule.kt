package expo.modules.chattimeline

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ChatTimelineModule : Module() {
  private val store: ChatMessageStore
    get() = ChatMessageStore.get(appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost())

  override fun definition() = ModuleDefinition {
    Name("ChatTimeline")

    AsyncFunction("upsert") Coroutine { accountId: String, matchId: String, messagesJson: String ->
      withContext(Dispatchers.IO) { store.upsert(accountId, matchId, messagesJson) }
    }
    AsyncFunction("latest") Coroutine { accountId: String, matchId: String, limit: Int ->
      withContext(Dispatchers.IO) { store.latest(accountId, matchId, limit) }
    }
    AsyncFunction("deleteMessages") Coroutine { accountId: String, matchId: String, ids: List<String> ->
      withContext(Dispatchers.IO) { store.deleteMessages(accountId, matchId, ids) }
    }
    AsyncFunction("clearMatch") Coroutine { accountId: String, matchId: String ->
      withContext(Dispatchers.IO) { store.clearMatch(accountId, matchId) }
    }
    AsyncFunction("clearAccount") Coroutine { accountId: String ->
      withContext(Dispatchers.IO) { store.clearAccount(accountId) }
    }
  }
}
