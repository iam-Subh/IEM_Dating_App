package expo.modules.chatnotify

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.io.File
import java.util.concurrent.Executors

/**
 * Voice messages played from the notification, like Telegram
 * (MESSAGE_NOTIFICATIONS_PLAN.md 7): a media player in the status bar and on
 * the lock screen - play/pause, seek, speed 1× / 1.5× / 2×, and the chat's
 * next unheard voice message.
 *
 * Android allows starting this from the notification's Play button (a
 * background-start exception for notification taps). It goes into the
 * foreground at once with a "Loading…" notification, which Media3's player
 * notification then replaces. When the last note ends, the session is
 * released and the service stops - Telegram once left its player stuck in the
 * status bar by not doing this.
 */
class VoicePlaybackService : MediaSessionService() {
  companion object {
    private const val ACTION_PLAY = "expo.modules.chatnotify.PLAY_VOICE"
    private const val SPEED = "expo.modules.chatnotify.SPEED"
    private val SPEEDS = floatArrayOf(1f, 1.5f, 2f)

    fun playIntent(context: Context, matchId: String, messageId: String): PendingIntent {
      val intent = Intent(context, VoicePlaybackService::class.java).setAction(ACTION_PLAY)
        .putExtra(ChatNotifier.EXTRA_MATCH, matchId)
        .putExtra(ChatNotifier.EXTRA_MESSAGE, messageId)
      return PendingIntent.getForegroundService(context, "play:$messageId".hashCode(), intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
  }

  private var session: MediaSession? = null
  private lateinit var player: ExoPlayer
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private val speedCommand = SessionCommand(SPEED, Bundle.EMPTY)
  private var speedIndex = 0
  private var matchId: String? = null

  override fun onCreate() {
    super.onCreate()
    player = ExoPlayer.Builder(this)
      // Speech; pauses for calls and other audio (audio focus), and when headphones come out.
      .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
      .setHandleAudioBecomingNoisy(true)
      .build()
    player.addListener(object : Player.Listener {
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        mediaItem?.mediaId?.let { markPlayed(it) }
      }
      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_ENDED) finish()
      }
    })
    session = MediaSession.Builder(this, player)
      .setId("iem-voice")
      .setCallback(object : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
          MediaSession.ConnectionResult.AcceptedResultBuilder(session)
            .setAvailableSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(speedCommand).build())
            .build()

        override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
          if (customCommand.customAction == SPEED) {
            speedIndex = (speedIndex + 1) % SPEEDS.size
            player.setPlaybackSpeed(SPEEDS[speedIndex])
            session.setCustomLayout(listOf(speedButton()))
          }
          return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
      })
      .setCustomLayout(listOf(speedButton()))
      .build()
  }

  private fun speedButton(): CommandButton {
    val speed = SPEEDS[speedIndex]
    return CommandButton.Builder(CommandButton.ICON_PLAYBACK_SPEED)
      .setDisplayName(if (speed == 1f) "1×" else "${speed}×")
      .setSessionCommand(speedCommand)
      .build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_PLAY) {
      val match = intent.getStringExtra(ChatNotifier.EXTRA_MATCH)
      val message = intent.getStringExtra(ChatNotifier.EXTRA_MESSAGE)
      // Foreground within Android's 5 seconds, before any network.
      goForeground()
      if (match != null && message != null) load(match, message) else finish()
      return START_NOT_STICKY
    }
    return super.onStartCommand(intent, flags, startId)
  }

  private fun goForeground() {
    ChatNotifier.ensureChannel(this)
    val loading = NotificationCompat.Builder(this, ChatNotifier.CHANNEL)
      .setSmallIcon(resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 } ?: applicationInfo.icon)
      .setContentTitle("Voice message")
      .setContentText("Loading…")
      .setSilent(true)
      .build()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
    // Same id as Media3's player notification, so it takes this one's place.
    ServiceCompat.startForeground(this, DefaultMediaNotificationProvider.DEFAULT_NOTIFICATION_ID, loading, type)
  }

  /** This note, then the chat's other unheard voice messages after it. */
  private fun load(match: String, first: String) {
    matchId = match
    val state = ChatStore.get(this, match)
    val queue = listOf(first) + (state?.lines ?: emptyList())
      .filter { it.kind == "voice" && !it.self && !it.played && it.id != first }
      .filter { line -> (state?.lines?.firstOrNull { it.id == first }?.time ?: 0) <= line.time }
      .map { it.id }
    io.execute {
      val items = queue.mapNotNull { id ->
        runCatching {
          val data = ChatApi.post(this, "voice-url", org.json.JSONObject().put("matchId", match).put("messageId", id)) ?: return@runCatching null
          val artwork = state?.avatarPath?.let { path -> runCatching { File(path).readBytes() }.getOrNull() }
          MediaItem.Builder()
            .setMediaId(id)
            .setUri(data.getString("url"))
            .setMediaMetadata(MediaMetadata.Builder()
              .setTitle("Voice message")
              .setArtist(if (state?.previews == true) data.optString("senderName") else "IEM Connect")
              .apply { if (artwork != null && state?.previews == true) setArtworkData(artwork, MediaMetadata.PICTURE_TYPE_FRONT_COVER) }
              .build())
            .build()
        }.getOrNull()
      }
      main.post {
        if (items.isEmpty()) {
          Toast.makeText(this, "Couldn't play this voice message", Toast.LENGTH_SHORT).show()
          finish()
          return@post
        }
        player.setMediaItems(items)
        player.setPlaybackSpeed(SPEEDS[speedIndex])
        player.prepare()
        player.play()
      }
    }
  }

  /** Blue microphone for the sender; "· played" in the notification (section 7). */
  private fun markPlayed(messageId: String) {
    val match = matchId ?: return
    ChatWork.played(this, match, messageId)
    ChatStore.update(this, match) { current ->
      current?.copy(lines = current.lines.map { if (it.id == messageId) it.copy(played = true) else it })
    }
    ChatNotifier.show(this, match, alert = false)
  }

  private fun finish() {
    runCatching { player.stop() }
    session?.run { release() }
    session = null
    runCatching { player.release() }
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    if (!player.playWhenReady || player.mediaItemCount == 0) finish()
  }

  override fun onDestroy() {
    session?.run { release() }
    session = null
    runCatching { player.release() }
    io.shutdown()
    super.onDestroy()
  }
}
