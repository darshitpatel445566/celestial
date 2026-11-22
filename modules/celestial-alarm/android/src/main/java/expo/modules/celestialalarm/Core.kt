package expo.modules.celestialalarm

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

internal object C {
  const val PREFS = "celestial_alarm"

  const val ACTION_FIRE = "expo.modules.celestialalarm.action.FIRE"
  const val ACTION_SNOOZE = "expo.modules.celestialalarm.action.SNOOZE"
  const val ACTION_DISMISS = "expo.modules.celestialalarm.action.DISMISS"
  const val ACTION_TASK = "expo.modules.celestialalarm.action.TASK"
  const val ACTION_DONE = "expo.modules.celestialalarm.action.DONE"
  const val ACTION_REMIND_SNOOZE = "expo.modules.celestialalarm.action.REMIND_SNOOZE"
  const val EXTRA_RING = "celestial_ring"
  const val EXTRA_ALARM = "celestial_alarm"
  const val EXTRA_TASK = "celestial_task"
  const val EXTRA_OCCURRENCE = "celestial_occurrence"

  val YELLOW: Int = 0xFFFFC93D.toInt()
  val BLUE: Int = 0xFF3F80FF.toInt()
  val RED: Int = 0xFFE5484D.toInt()

  const val CH_RING = "celestial_ring_v1"
  const val CH_REMIND = "celestial_reminders_v1"
  const val CH_STATUS = "celestial_status_v1"
  const val CH_FALLBACK = "celestial_fallback_v1"

  const val NOTIF_RING = 4101
  const val NOTIF_SNOOZE = 4102
  const val NOTIF_FALLBACK = 4103

  const val REQ_FIRE = 5101
  const val REQ_SHOW = 5102
  const val REQ_RING = 5103
  const val REQ_SNOOZE = 5104
  const val REQ_DISMISS = 5105

  /** A trigger that is late by less than this still rings (e.g. phone restarted at 8:58 for 9:00). */
  const val LATE_GRACE_MS = 10 * 60 * 1000L
}

/**
 * One moment when something should ring or notify. Built by the JavaScript schedule.
 * `wall` is the local wall-clock time ("yyyy-MM-dd HH:mm") so a time-zone change keeps 9:00 at 9:00.
 */
internal class Trigger(val json: JSONObject) {
  val id: String get() = json.optString("id", "")
  val alarmId: String get() = json.optString("alarmId", "")
  val kind: String get() = json.optString("kind", "main")
  val style: String get() = json.optString("style", "ring")
  val title: String get() = json.optString("title", "Alarm")
  val body: String get() = json.optString("body", "")
  val sound: String get() = json.optString("sound", "raw:beacon")
  val rising: Boolean get() = json.optBoolean("rising", true)
  val vibrate: Boolean get() = json.optBoolean("vibrate", true)
  val ringMinutes: Int get() = json.optInt("ringMinutes", if (style == "pre") 1 else 10)
  val snoozeMinutes: Int get() = json.optInt("snoozeMinutes", 10)
  val snoozeLimit: Int get() = json.optInt("snoozeLimit", 3)
  val snoozeCount: Int get() = json.optInt("snoozeCount", 0)
  val occurrence: String get() = json.optString("occurrence", "")
  val isReminder: Boolean get() = json.optString("itemKind", "alarm") == "reminder"
  val due: String get() = json.optString("due", body)
  val overdue: Boolean get() = json.optBoolean("overdue", false)
  val canDone: Boolean get() = json.optBoolean("canDone", false)
  val color: Int get() = if (isReminder) C.BLUE else C.YELLOW

  /** Checklist items: {id, text, done, level} */
  fun tasks(): List<JSONObject> {
    val out = mutableListOf<JSONObject>()
    val arr = json.optJSONArray("tasks") ?: return out
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i)
      if (o != null) out.add(o)
    }
    return out
  }

  val timeMillis: Long = computeTime()

  private fun computeTime(): Long {
    val wall = json.optString("wall", "")
    if (wall.length >= 16) {
      try {
        val c = Calendar.getInstance()
        c.set(
          wall.substring(0, 4).toInt(),
          wall.substring(5, 7).toInt() - 1,
          wall.substring(8, 10).toInt(),
          wall.substring(11, 13).toInt(),
          wall.substring(14, 16).toInt(),
          0
        )
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
      } catch (e: Exception) {
        // fall back to the absolute time below
      }
    }
    return json.optLong("at", 0L)
  }

  fun copyJson(): JSONObject = JSONObject(json.toString())
}

internal object Store {
  const val SCHEDULE = "schedule"
  const val SNOOZES = "snoozes"
  const val MISSED = "missed"
  const val QUEUE = "queue"
  const val RING = "ring"
  /** Reminder notifications on screen, by alarm id (to redraw them after a task tick) */
  const val SHOWN = "shown"
  /** Ticks and "Mark done" taps from notifications, for JavaScript to apply */
  const val PENDING = "pending"

  fun prefs(ctx: Context): SharedPreferences =
    ctx.applicationContext.getSharedPreferences(C.PREFS, Context.MODE_PRIVATE)

  fun readList(ctx: Context, key: String): MutableList<JSONObject> {
    val out = mutableListOf<JSONObject>()
    val raw = prefs(ctx).getString(key, null) ?: return out
    try {
      val arr = JSONArray(raw)
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i)
        if (o != null) out.add(o)
      }
    } catch (e: Exception) {
      // corrupted value: treat as empty
    }
    return out
  }

  fun writeList(ctx: Context, key: String, list: List<JSONObject>) {
    val arr = JSONArray()
    for (o in list) arr.put(o)
    prefs(ctx).edit().putString(key, arr.toString()).commit()
  }

  fun readObject(ctx: Context, key: String): JSONObject? {
    val raw = prefs(ctx).getString(key, null) ?: return null
    return try {
      JSONObject(raw)
    } catch (e: Exception) {
      null
    }
  }

  fun writeObject(ctx: Context, key: String, obj: JSONObject?) {
    val editor = prefs(ctx).edit()
    if (obj == null) editor.remove(key) else editor.putString(key, obj.toString())
    editor.commit()
  }
}

internal object Intents {
  val FLAGS: Int = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  private fun base(ctx: Context): Intent {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val intent = Intent()
    val component = launch?.component
    if (component != null) intent.setComponent(component) else intent.setPackage(ctx.packageName)
    return intent
  }

  /** Opens the app normally. */
  fun open(ctx: Context): Intent {
    val intent = base(ctx)
    intent.setAction(Intent.ACTION_MAIN)
    intent.addCategory(Intent.CATEGORY_LAUNCHER)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return intent
  }

  /** A broadcast to our receiver; the data URI keeps each button's PendingIntent distinct. */
  fun action(ctx: Context, action: String, key: String): Intent {
    val intent = Intent(ctx, AlarmReceiver::class.java)
    intent.setAction(action)
    intent.setData(Uri.parse("celestial-action://" + Uri.encode(action) + "/" + Uri.encode(key)))
    return intent
  }

  /** Opens a deep link inside the app, e.g. celestial://ring */
  fun deepLink(ctx: Context, url: String, ring: Boolean): Intent {
    val intent = base(ctx)
    intent.setAction(Intent.ACTION_VIEW)
    intent.setData(Uri.parse(url))
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (ring) intent.putExtra(C.EXTRA_RING, true)
    return intent
  }
}

/** Lets native code tell JavaScript that something started or stopped ringing. */
internal object RingEvents {
  @Volatile
  var listener: ((String, Map<String, Any?>) -> Unit)? = null

  fun emit(name: String, body: Map<String, Any?>) {
    try {
      listener?.invoke(name, body)
    } catch (e: Exception) {
      // JavaScript is not running; the ring screen reads the state when it opens
    }
  }
}
