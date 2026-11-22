package expo.modules.celestialalarm

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator

/**
 * Plays the alarm: sound on the alarm stream (rings even on silent), rising volume, vibration,
 * and the full-screen notification that opens the ring screen over the lock screen.
 */
class RingService : Service() {

  companion object {
    const val ACTION_START = "expo.modules.celestialalarm.action.START"

    @Volatile
    var instance: RingService? = null
  }

  private val handler = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  private var vibrator: Vibrator? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var focusRequest: AudioFocusRequest? = null
  private var current: Trigger? = null
  private var volume = 1f
  private var maxVolume = 1f
  private var missionMode = false
  private var savedAlarmVolume = -1

  private val alarmAttributes: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ALARM)
    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
    .build()

  private val ramp: Runnable = object : Runnable {
    override fun run() {
      val p = player ?: return
      if (missionMode) return
      if (volume < maxVolume) {
        volume = minOf(maxVolume, volume + 0.075f)
        try {
          p.setVolume(volume, volume)
        } catch (e: Exception) {
          // player was released
        }
        handler.postDelayed(this, 1000L)
      }
    }
  }

  private val timeout: Runnable = Runnable { onTimeout() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val t = RingState.trigger(this)
    // startForegroundService() requires startForeground() right away, whatever happens next.
    val notification = Notifs.buildRing(this, t, snoozesLeft(t))
    try {
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(C.NOTIF_RING, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(C.NOTIF_RING, notification)
      }
    } catch (e: Exception) {
      if (t != null) Notifs.showFallback(this, t)
      stopSelf()
      return Service.START_NOT_STICKY
    }
    if (t == null || !RingState.isRinging(this)) {
      finish(false)
      return Service.START_NOT_STICKY
    }
    begin(t)
    return Service.START_NOT_STICKY
  }

  private fun snoozesLeft(t: Trigger?): Int {
    if (t == null || t.style == "pre") return 0
    val used = RingState.load(this).optInt("snoozeCount", 0)
    return maxOf(0, t.snoozeLimit - used)
  }

  private fun begin(t: Trigger) {
    stopOutputs()
    current = t
    missionMode = false
    acquireWakeLock()
    val pre = t.style == "pre"
    maxVolume = if (pre) 0.55f else 1f
    // Rising volume starts at a quarter and reaches full in about 10 seconds.
    volume = if (pre) 0.15f else if (t.rising) 0.25f else maxVolume
    requestFocus()
    ensureAudible()
    startSound(Sounds.resolve(this, t.sound))
    if (t.vibrate) startVibration(pre)
    if (volume < maxVolume) handler.postDelayed(ramp, 1000L)
    val minutes = if (t.ringMinutes > 0) t.ringMinutes else 10
    handler.postDelayed(timeout, minutes * 60_000L)
  }

  private fun onTimeout() {
    val t = current ?: return
    if (missionMode) {
      // Never interrupt someone who is solving the mission.
      handler.postDelayed(timeout, 60_000L)
      return
    }
    if (t.style == "pre") {
      RingEvents.emit("onRingEnd", mapOf("reason" to "timeout"))
      finish(true)
      ringQueued()
      return
    }
    if (snoozesLeft(t) > 0) {
      snooze(true)
    }
    // No snoozes left: keep ringing until the mission is solved.
  }

  fun snooze(auto: Boolean): Boolean {
    val t = current ?: RingState.trigger(this)
    if (t != null && t.style == "pre") {
      dismissPre()
      return true
    }
    val ok = Ringer.scheduleSnooze(this, auto)
    if (ok) finish(false)
    return ok
  }

  fun dismissPre() {
    RingState.clear(this)
    RingEvents.emit("onRingEnd", mapOf("reason" to "dismissed"))
    finish(true)
    ringQueued()
  }

  fun stopAlarm() {
    RingState.clear(this)
    RingEvents.emit("onRingEnd", mapOf("reason" to "stopped"))
    finish(true)
    ringQueued()
  }

  /** Another alarm came due while this one rang: ring it next, through a fresh exact alarm. */
  private fun ringQueued() {
    val next = RingState.dequeue(this) ?: return
    val now = System.currentTimeMillis()
    if (next.timeMillis > now - 30 * 60_000L) {
      val j = next.copyJson()
      val at = now + 1500L
      j.put("id", next.alarmId + ":queued:" + at)
      j.put("at", at)
      j.remove("wall")
      Scheduler.addSnooze(applicationContext, j)
      Scheduler.armNext(applicationContext)
    } else {
      ringQueued()
    }
  }

  /** While a mission is being solved the alarm goes quiet; after 10 idle seconds JavaScript turns it back on. */
  fun setMissionMode(on: Boolean) {
    missionMode = on
    val p = player
    if (on) {
      handler.removeCallbacks(ramp)
      try {
        p?.setVolume(0f, 0f)
      } catch (e: Exception) {
        // ignore
      }
      try {
        vibrator?.cancel()
      } catch (e: Exception) {
        // ignore
      }
      vibrator = null
    } else {
      volume = maxVolume
      try {
        p?.setVolume(volume, volume)
      } catch (e: Exception) {
        // ignore
      }
      val t = current
      if (t != null && t.vibrate && vibrator == null) startVibration(t.style == "pre")
    }
  }

  private fun startSound(uri: Uri) {
    val candidates = listOfNotNull(uri, defaultAlarmUri(), Sounds.rawUri(this, "beacon"))
    for (u in candidates) {
      val mp = MediaPlayer()
      try {
        mp.setAudioAttributes(alarmAttributes)
        mp.setDataSource(this, u)
        mp.isLooping = true
        mp.prepare()
        mp.setVolume(volume, volume)
        mp.start()
        player = mp
        return
      } catch (e: Exception) {
        try {
          mp.release()
        } catch (ignored: Exception) {
          // ignore
        }
      }
    }
  }

  private fun defaultAlarmUri(): Uri? {
    return try {
      RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    } catch (e: Exception) {
      null
    }
  }

  private fun startVibration(pre: Boolean) {
    val v: Vibrator = Haptic.vibrator(this) ?: return
    if (!v.hasVibrator()) return
    val pattern = if (pre) longArrayOf(0, 180, 220, 180, 2400) else longArrayOf(0, 700, 500, 700, 1100)
    try {
      if (Build.VERSION.SDK_INT >= 33) {
        v.vibrate(
          VibrationEffect.createWaveform(pattern, 0),
          VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM)
        )
      } else if (Build.VERSION.SDK_INT >= 26) {
        v.vibrate(VibrationEffect.createWaveform(pattern, 0), alarmAttributes)
      } else {
        v.vibrate(pattern, 0)
      }
      vibrator = v
    } catch (e: Exception) {
      // no vibration on this device
    }
  }

  private fun ensureAudible() {
    try {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val cur = audio.getStreamVolume(AudioManager.STREAM_ALARM)
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
      if (cur == 0 && max > 0) {
        savedAlarmVolume = cur
        audio.setStreamVolume(AudioManager.STREAM_ALARM, maxOf(1, max / 2), 0)
      }
    } catch (e: Exception) {
      // ignore
    }
  }

  private fun restoreVolume() {
    if (savedAlarmVolume < 0) return
    try {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      audio.setStreamVolume(AudioManager.STREAM_ALARM, savedAlarmVolume, 0)
    } catch (e: Exception) {
      // ignore
    }
    savedAlarmVolume = -1
  }

  private fun requestFocus() {
    try {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (Build.VERSION.SDK_INT >= 26) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(alarmAttributes)
          .build()
        audio.requestAudioFocus(request)
        focusRequest = request
      } else {
        audio.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      }
    } catch (e: Exception) {
      // ignore
    }
  }

  private fun abandonFocus() {
    try {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (Build.VERSION.SDK_INT >= 26) {
        val request = focusRequest
        if (request != null) audio.abandonAudioFocusRequest(request)
      } else {
        audio.abandonAudioFocus(null)
      }
    } catch (e: Exception) {
      // ignore
    }
    focusRequest = null
  }

  private fun acquireWakeLock() {
    try {
      if (wakeLock?.isHeld == true) return
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      val lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "celestial:ring")
      lock.setReferenceCounted(false)
      lock.acquire(30 * 60_000L)
      wakeLock = lock
    } catch (e: Exception) {
      // ignore
    }
  }

  private fun releaseWakeLock() {
    try {
      val lock = wakeLock
      if (lock != null && lock.isHeld) lock.release()
    } catch (e: Exception) {
      // ignore
    }
    wakeLock = null
  }

  private fun stopOutputs() {
    handler.removeCallbacks(ramp)
    handler.removeCallbacks(timeout)
    val p = player
    player = null
    if (p != null) {
      try {
        p.stop()
      } catch (e: Exception) {
        // ignore
      }
      try {
        p.release()
      } catch (e: Exception) {
        // ignore
      }
    }
    try {
      vibrator?.cancel()
    } catch (e: Exception) {
      // ignore
    }
    vibrator = null
    abandonFocus()
    restoreVolume()
    releaseWakeLock()
  }

  private fun finish(clearState: Boolean) {
    stopOutputs()
    if (clearState) RingState.clear(this)
    current = null
    missionMode = false
    stopForeground(Service.STOP_FOREGROUND_REMOVE)
    Notifs.cancel(this, C.NOTIF_RING)
    stopSelf()
  }

  override fun onDestroy() {
    stopOutputs()
    if (instance === this) instance = null
    super.onDestroy()
  }
}
