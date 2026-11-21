package expo.modules.celestialalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * Keeps the list of upcoming triggers and arms the earliest one with AlarmManager.setAlarmClock,
 * the most reliable way to wake an Android phone at an exact time.
 */
internal object Scheduler {

  fun setSchedule(ctx: Context, json: String) {
    val list = mutableListOf<JSONObject>()
    val arr = JSONArray(json)
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i)
      if (o != null) list.add(o)
    }
    Store.writeList(ctx, Store.SCHEDULE, list)
    armNext(ctx)
  }

  fun addSnooze(ctx: Context, obj: JSONObject) {
    val alarmId = obj.optString("alarmId", "")
    val list = Store.readList(ctx, Store.SNOOZES)
    list.removeAll { it.optString("alarmId", "") == alarmId }
    list.add(obj)
    Store.writeList(ctx, Store.SNOOZES, list)
  }

  fun cancelSnooze(ctx: Context, alarmId: String) {
    val list = Store.readList(ctx, Store.SNOOZES)
    val changed = list.removeAll { it.optString("alarmId", "") == alarmId }
    if (changed) Store.writeList(ctx, Store.SNOOZES, list)
    armNext(ctx)
  }

  private fun pending(ctx: Context): List<Trigger> {
    val all = Store.readList(ctx, Store.SCHEDULE) + Store.readList(ctx, Store.SNOOZES)
    return all.map { Trigger(it) }
  }

  /** Triggers that are too late to ring (phone was off) move to the missed list. */
  private fun pruneMissed(ctx: Context, now: Long) {
    val cutoff = now - C.LATE_GRACE_MS
    val missed = Store.readList(ctx, Store.MISSED)
    var missedChanged = false
    for (key in arrayOf(Store.SCHEDULE, Store.SNOOZES)) {
      val list = Store.readList(ctx, key)
      val keep = mutableListOf<JSONObject>()
      for (o in list) {
        val t = Trigger(o)
        if (t.timeMillis < cutoff) {
          if (t.style != "pre") {
            val m = JSONObject()
            m.put("alarmId", t.alarmId)
            m.put("at", t.timeMillis)
            m.put("kind", t.kind)
            m.put("title", t.title)
            missed.add(m)
            missedChanged = true
          }
        } else {
          keep.add(o)
        }
      }
      if (keep.size != list.size) Store.writeList(ctx, key, keep)
    }
    if (missedChanged) {
      while (missed.size > 50) missed.removeAt(0)
      Store.writeList(ctx, Store.MISSED, missed)
    }
  }

  fun armNext(ctx: Context) {
    val now = System.currentTimeMillis()
    pruneMissed(ctx, now)
    val next = pending(ctx).minByOrNull { it.timeMillis }
    val alarmManager = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val fire = firePendingIntent(ctx)
    if (next == null) {
      alarmManager.cancel(fire)
      Store.prefs(ctx).edit().remove("armedAt").commit()
      return
    }
    val at = maxOf(next.timeMillis, now + 1000L)
    val show = PendingIntent.getActivity(ctx, C.REQ_SHOW, Intents.open(ctx), Intents.FLAGS)
    try {
      if (Build.VERSION.SDK_INT >= 31 && !alarmManager.canScheduleExactAlarms()) {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire)
      } else {
        alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), fire)
      }
    } catch (e: SecurityException) {
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire)
    }
    Store.prefs(ctx).edit().putLong("armedAt", at).commit()
  }

  /** Removes and returns everything that is due now. */
  fun takeDue(ctx: Context): List<Trigger> {
    val now = System.currentTimeMillis()
    pruneMissed(ctx, now)
    val due = mutableListOf<Trigger>()
    for (key in arrayOf(Store.SCHEDULE, Store.SNOOZES)) {
      val list = Store.readList(ctx, key)
      val keep = mutableListOf<JSONObject>()
      for (o in list) {
        val t = Trigger(o)
        if (t.timeMillis <= now + 1500L) due.add(t) else keep.add(o)
      }
      if (keep.size != list.size) Store.writeList(ctx, key, keep)
    }
    return due.sortedBy { it.timeMillis }
  }

  fun firePendingIntent(ctx: Context): PendingIntent {
    val intent = Intent(ctx, AlarmReceiver::class.java)
    intent.setAction(C.ACTION_FIRE)
    return PendingIntent.getBroadcast(ctx, C.REQ_FIRE, intent, Intents.FLAGS)
  }

  fun armedAt(ctx: Context): Long = Store.prefs(ctx).getLong("armedAt", 0L)
}

/** What is ringing (or snoozed) right now. Survives the app being closed. */
internal object RingState {
  fun load(ctx: Context): JSONObject = Store.readObject(ctx, Store.RING) ?: JSONObject()

  fun isRinging(ctx: Context): Boolean = load(ctx).optBoolean("ringing", false)

  fun trigger(ctx: Context): Trigger? {
    val t = load(ctx).optJSONObject("trigger") ?: return null
    return Trigger(t)
  }

  fun saveRinging(ctx: Context, t: Trigger) {
    val o = JSONObject()
    o.put("ringing", true)
    o.put("trigger", t.json)
    o.put("startedAt", System.currentTimeMillis())
    o.put("snoozeCount", t.snoozeCount)
    o.put("missionMode", false)
    Store.writeObject(ctx, Store.RING, o)
  }

  fun saveSnoozed(ctx: Context, t: Trigger, count: Int, until: Long) {
    val o = JSONObject()
    o.put("ringing", false)
    o.put("snoozed", true)
    o.put("trigger", t.json)
    o.put("snoozeCount", count)
    o.put("snoozedUntil", until)
    Store.writeObject(ctx, Store.RING, o)
  }

  fun setMission(ctx: Context, on: Boolean) {
    val o = load(ctx)
    if (!o.optBoolean("ringing", false)) return
    o.put("missionMode", on)
    Store.writeObject(ctx, Store.RING, o)
  }

  fun clear(ctx: Context) {
    Store.writeObject(ctx, Store.RING, null)
  }

  fun toJson(ctx: Context): String {
    val o = load(ctx)
    val out = JSONObject()
    out.put("ringing", o.optBoolean("ringing", false))
    out.put("snoozed", o.optBoolean("snoozed", false))
    out.put("trigger", o.optJSONObject("trigger") ?: JSONObject.NULL)
    out.put("snoozeCount", o.optInt("snoozeCount", 0))
    out.put("snoozedUntil", o.optLong("snoozedUntil", 0L))
    out.put("startedAt", o.optLong("startedAt", 0L))
    out.put("missionMode", o.optBoolean("missionMode", false))
    out.put("serviceAlive", RingService.instance != null)
    return out.toString()
  }

  fun enqueue(ctx: Context, t: Trigger) {
    val q = Store.readList(ctx, Store.QUEUE)
    q.add(t.json)
    Store.writeList(ctx, Store.QUEUE, q)
  }

  fun dequeue(ctx: Context): Trigger? {
    val q = Store.readList(ctx, Store.QUEUE)
    if (q.isEmpty()) return null
    val first = q.removeAt(0)
    Store.writeList(ctx, Store.QUEUE, q)
    return Trigger(first)
  }
}

/** Decides how a due trigger is presented: full ring, gentle pre-alarm, or a notification. */
internal object Ringer {

  fun deliver(ctx: Context, t: Trigger) {
    if (t.style == "notify") {
      Notifs.showReminder(ctx, t)
      RingEvents.emit("onReminder", mapOf("trigger" to t.json.toString()))
      return
    }
    if (RingState.isRinging(ctx) && RingService.instance != null) {
      // Something is already ringing: never cut it off.
      if (t.style == "pre") Notifs.showReminder(ctx, t) else RingState.enqueue(ctx, t)
      return
    }
    start(ctx, t)
  }

  fun start(ctx: Context, t: Trigger) {
    Notifs.cancel(ctx, C.NOTIF_SNOOZE)
    RingState.saveRinging(ctx, t)
    val intent = Intent(ctx, RingService::class.java)
    intent.setAction(RingService.ACTION_START)
    try {
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
    } catch (e: Exception) {
      Notifs.showFallback(ctx, t)
    }
    RingEvents.emit("onRing", mapOf("trigger" to t.json.toString()))
  }

  /** Schedules the next ring of the current alarm. Works with or without the ring service. */
  fun scheduleSnooze(ctx: Context, auto: Boolean): Boolean {
    val t = RingState.trigger(ctx) ?: return false
    if (t.style == "pre") return false
    val count = RingState.load(ctx).optInt("snoozeCount", 0)
    if (count >= t.snoozeLimit) return false
    val minutes = if (t.snoozeMinutes > 0) t.snoozeMinutes else 10
    val at = System.currentTimeMillis() + minutes * 60_000L
    val j = t.copyJson()
    j.put("id", t.alarmId + ":snooze:" + at)
    j.put("kind", "snooze")
    j.put("style", "ring")
    j.put("at", at)
    j.remove("wall")
    j.put("snoozeCount", count + 1)
    Scheduler.addSnooze(ctx, j)
    RingState.saveSnoozed(ctx, t, count + 1, at)
    Scheduler.armNext(ctx)
    Notifs.cancel(ctx, C.NOTIF_RING)
    Notifs.cancel(ctx, C.NOTIF_FALLBACK)
    Notifs.showSnoozed(ctx, t, at, auto)
    RingEvents.emit("onRingEnd", mapOf("reason" to (if (auto) "autoSnooze" else "snooze"), "until" to at.toDouble()))
    return true
  }

  /** Clean-up when the ring service is not running (e.g. backup notification was used). */
  fun stopWithoutService(ctx: Context) {
    RingState.clear(ctx)
    Notifs.cancel(ctx, C.NOTIF_RING)
    Notifs.cancel(ctx, C.NOTIF_FALLBACK)
    RingEvents.emit("onRingEnd", mapOf("reason" to "stopped"))
  }

  /** A quick test ring a few seconds from now, using the given trigger fields. */
  fun scheduleTest(ctx: Context, json: String, seconds: Int) {
    val j = JSONObject(json)
    val at = System.currentTimeMillis() + maxOf(1, seconds) * 1000L
    j.put("id", "test:" + at)
    j.put("at", at)
    j.remove("wall")
    if (!j.has("alarmId")) j.put("alarmId", "test")
    Scheduler.addSnooze(ctx, j)
    Scheduler.armNext(ctx)
  }
}
