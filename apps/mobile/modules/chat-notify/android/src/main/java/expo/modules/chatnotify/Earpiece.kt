package expo.modules.chatnotify

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * Raise to ear, like WhatsApp and Telegram (MESSAGE_NOTIFICATIONS_PLAN.md 7):
 * while a voice message plays, the proximity sensor is watched. Held to the
 * ear, the screen turns off and the message continues through the earpiece,
 * as a call would sound; taken away, it goes back to the speaker. The app
 * swaps between its own player and this one at the same position.
 */
object Earpiece {
  private val main = Handler(Looper.getMainLooper())
  private var sensorListener: SensorEventListener? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var player: ExoPlayer? = null
  private var previousMode = AudioManager.MODE_NORMAL
  @Volatile var near = false
    private set

  /** Starts watching the sensor; `onChange(near)` on every change. False if the phone has no proximity sensor. */
  fun watch(context: Context, onChange: (Boolean) -> Unit): Boolean {
    stopWatching(context)
    val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val sensor = sensors.getDefaultSensor(Sensor.TYPE_PROXIMITY) ?: return false
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    // Turns the screen off while it is at the ear, so a cheek can't tap anything.
    if (power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
      wakeLock = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "iem:voice-ear").apply {
        setReferenceCounted(false)
        acquire(10 * 60 * 1000L)
      }
    }
    val listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        val isNear = event.values.firstOrNull()?.let { it < minOf(sensor.maximumRange, 5f) } ?: false
        if (isNear != near) {
          near = isNear
          onChange(isNear)
        }
      }
      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }
    sensorListener = listener
    sensors.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
    return true
  }

  fun stopWatching(context: Context) {
    sensorListener?.let { (context.getSystemService(Context.SENSOR_SERVICE) as SensorManager).unregisterListener(it) }
    sensorListener = null
    near = false
    runCatching { wakeLock?.release() }
    wakeLock = null
  }

  /** Plays `uri` from `positionMs` through the earpiece; `onEnded` when it finishes. */
  fun play(context: Context, uri: String, positionMs: Long, rate: Float, onEnded: () -> Unit) {
    main.post {
      stopPlayer(context)
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      previousMode = audio.mode
      // Call audio goes to the earpiece.
      audio.mode = AudioManager.MODE_IN_COMMUNICATION
      routeToEarpiece(audio)
      val next = ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_VOICE_COMMUNICATION).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), false)
        .build()
      next.addListener(object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
          if (state == Player.STATE_ENDED) {
            stopPlayer(context)
            onEnded()
          }
        }
      })
      next.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
      next.setPlaybackSpeed(rate)
      next.prepare()
      next.seekTo(positionMs)
      next.play()
      player = next
    }
  }

  /** Stops the earpiece player; returns where it was, so the app's player continues from there. */
  fun stop(context: Context): Long {
    var position = 0L
    val done = java.util.concurrent.CountDownLatch(1)
    main.post {
      position = player?.currentPosition ?: 0L
      stopPlayer(context)
      done.countDown()
    }
    done.await(1, java.util.concurrent.TimeUnit.SECONDS)
    return position
  }

  private fun stopPlayer(context: Context) {
    player?.run { stop(); release() }
    player = null
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audio.clearCommunicationDevice()
    @Suppress("DEPRECATION")
    audio.isSpeakerphoneOn = false
    audio.mode = previousMode
  }

  private fun routeToEarpiece(audio: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      audio.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
        ?.let { audio.setCommunicationDevice(it) }
    } else {
      @Suppress("DEPRECATION")
      audio.isSpeakerphoneOn = false
    }
  }
}
