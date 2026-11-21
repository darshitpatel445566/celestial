package expo.modules.celestialalarm

import android.app.Activity
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

/** Alarm sounds: four bundled Celestial sounds plus the phone's own alarm sounds. */
internal object Sounds {
  private val bundled = listOf(
    "beacon" to "Beacon",
    "rise" to "Rise",
    "chime" to "Chime",
    "drift" to "Drift"
  )
  private var previewPlayer: MediaPlayer? = null
  private val handler = Handler(Looper.getMainLooper())
  private val stopRunnable = Runnable { stopPreview() }

  fun rawUri(ctx: Context, name: String): Uri {
    val res = when (name) {
      "rise" -> R.raw.celestial_rise
      "chime" -> R.raw.celestial_chime
      "drift" -> R.raw.celestial_drift
      else -> R.raw.celestial_beacon
    }
    return Uri.parse("android.resource://" + ctx.packageName + "/" + res)
  }

  fun resolve(ctx: Context, id: String?): Uri {
    if (id == null || id.isEmpty()) return rawUri(ctx, "beacon")
    if (id.startsWith("raw:")) return rawUri(ctx, id.substring(4))
    return try {
      Uri.parse(id)
    } catch (e: Exception) {
      rawUri(ctx, "beacon")
    }
  }

  fun list(ctx: Context): String {
    val arr = JSONArray()
    for (pair in bundled) {
      val o = JSONObject()
      o.put("id", "raw:" + pair.first)
      o.put("title", pair.second)
      o.put("group", "celestial")
      arr.put(o)
    }
    try {
      val manager = RingtoneManager(ctx)
      manager.setType(RingtoneManager.TYPE_ALARM)
      val cursor = manager.cursor
      var count = 0
      while (count < 60 && cursor.moveToNext()) {
        val title = cursor.getString(RingtoneManager.TITLE_COLUMN_INDEX)
        val uri = manager.getRingtoneUri(cursor.position)
        if (title != null && uri != null) {
          val o = JSONObject()
          o.put("id", uri.toString())
          o.put("title", title)
          o.put("group", "phone")
          arr.put(o)
          count++
        }
      }
    } catch (e: Exception) {
      // phone sounds unavailable; bundled ones still work
    }
    return arr.toString()
  }

  fun preview(ctx: Context, id: String) {
    stopPreview()
    val mp = MediaPlayer()
    try {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      mp.setAudioAttributes(attrs)
      mp.setDataSource(ctx, resolve(ctx, id))
      mp.isLooping = false
      mp.prepare()
      mp.setVolume(0.7f, 0.7f)
      mp.start()
      previewPlayer = mp
      handler.removeCallbacks(stopRunnable)
      handler.postDelayed(stopRunnable, 5000L)
    } catch (e: Exception) {
      try {
        mp.release()
      } catch (ignored: Exception) {
        // ignore
      }
    }
  }

  fun stopPreview() {
    handler.removeCallbacks(stopRunnable)
    val p = previewPlayer ?: return
    previewPlayer = null
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
}

/** Which permissions alarms need, and shortcuts to the matching settings pages. */
internal object Perms {
  fun status(ctx: Context): String {
    val o = JSONObject()
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    o.put("notifications", nm.areNotificationsEnabled())
    o.put("exactAlarms", Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms())
    o.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent())
    o.put("battery", pm.isIgnoringBatteryOptimizations(ctx.packageName))
    o.put("sdk", Build.VERSION.SDK_INT)
    o.put("manufacturer", Build.MANUFACTURER ?: "")
    o.put("model", Build.MODEL ?: "")
    return o.toString()
  }

  fun open(ctx: Context, which: String): Boolean {
    val pkg = Uri.parse("package:" + ctx.packageName)
    val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
    val intent: Intent = when (which) {
      "notifications" ->
        if (Build.VERSION.SDK_INT >= 26) {
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
        } else {
          details
        }
      "exactAlarms" ->
        if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg) else details
      "fullScreen" ->
        if (Build.VERSION.SDK_INT >= 34) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg) else details
      "battery" -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
      else -> details
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      ctx.startActivity(intent)
      true
    } catch (e: Exception) {
      try {
        details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(details)
        true
      } catch (e2: Exception) {
        false
      }
    }
  }
}

/** Shows the app over the lock screen only while an alarm is ringing. */
internal object LockScreen {
  private var activityRef: WeakReference<Activity>? = null

  @Volatile
  var resumed = false

  @Volatile
  var launchedForRing = false

  fun attach(activity: Activity) {
    activityRef = WeakReference(activity)
  }

  fun detach(activity: Activity) {
    if (activityRef?.get() === activity) activityRef = null
  }

  fun current(): Activity? = activityRef?.get()

  fun isRingIntent(intent: Intent?): Boolean {
    if (intent == null) return false
    if (intent.getBooleanExtra(C.EXTRA_RING, false)) return true
    val data = intent.data ?: return false
    return data.scheme == "celestial" && data.host == "ring"
  }

  fun showForRing(activity: Activity, fresh: Boolean) {
    if (!RingState.isRinging(activity.applicationContext)) return
    if (fresh) launchedForRing = true
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= 27) {
        activity.setShowWhenLocked(true)
        activity.setTurnScreenOn(true)
      } else {
        activity.window.addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
      }
      activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  fun release(moveToBack: Boolean) {
    val activity = current() ?: return
    val back = moveToBack && launchedForRing
    launchedForRing = false
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= 27) {
        activity.setShowWhenLocked(false)
        activity.setTurnScreenOn(false)
      } else {
        activity.window.clearFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
      }
      activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      if (back) activity.moveTaskToBack(true)
    }
  }

  fun isLocked(ctx: Context): Boolean {
    val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    return km.isKeyguardLocked
  }
}
