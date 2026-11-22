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
    val done = Actions.pendingDoneKeys(ctx)
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      // A "Mark done" tapped in a notification wins until JavaScript has applied it.
      if (done.contains(o.optString("alarmId", "") + "|" + o.optString("occurrence", ""))) continue
      list.add(o)
    }
    Store.writeList(ctx, Store.SCHEDULE, list)
    armNext(ctx)
  }

  /** Stops the remaining reminders of one occurrence (after "Mark done"). */
  fun dropOccurrence(ctx: Context, alarmId: String, occurrence: String) {
    for (key in arrayOf(Store.SCHEDULE, Store.SNOOZES)) {
      val list = Store.readList(ctx, key)
      val keep = list.filter { !(it.optString("alarmId", "") == alarmId && it.optString("occurrence", "") == occurrence) }
      if (keep.size != list.size) Store.writeList(ctx, key, keep)
    }
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

/**
 * Taps on reminder notifications: tick a task, mark done, snooze. They are stored for JavaScript
 * (which owns the alarms) and applied the next time the app runs.
 */
internal object Actions {
  private fun loadPending(ctx: Context): JSONObject = Store.readObject(ctx, Store.PENDING) ?: JSONObject()

  private fun savePending(ctx: Context, o: JSONObject) {
    Store.writeObject(ctx, Store.PENDING, o)
  }

  private fun loadShown(ctx: Context): JSONObject = Store.readObject(ctx, Store.SHOWN) ?: JSONObject()

  fun pendingDoneKeys(ctx: Context): Set<String> {
    val out = mutableSetOf<String>()
    val done = loadPending(ctx).optJSONArray("done") ?: return out
    for (i in 0 until done.length()) {
      val o = done.optJSONObject(i) ?: continue
      out.add(o.optString("alarmId", "") + "|" + o.optString("occurrence", ""))
    }
    return out
  }

  /** The trigger's tasks with any notification ticks JavaScript has not seen yet. */
  fun withPendingTicks(ctx: Context, t: Trigger): List<JSONObject> {
    val tasks = t.tasks().map { JSONObject(it.toString()) }
    val toggles = loadPending(ctx).optJSONArray("toggles") ?: return tasks
    for (i in 0 until toggles.length()) {
      val tg = toggles.optJSONObject(i) ?: continue
      if (tg.optString("alarmId", "") != t.alarmId || tg.optString("occurrence", "") != t.occurrence) continue
      for (task in tasks) {
        if (task.optString("id", "") == tg.optString("taskId", "")) task.put("done", tg.optBoolean("done", false))
      }
    }
    return tasks
  }

  fun rememberShown(ctx: Context, t: Trigger, snoozedUntil: Long) {
    val shown = loadShown(ctx)
    val entry = JSONObject()
    entry.put("trigger", t.json)
    entry.put("snoozedUntil", snoozedUntil)
    entry.put("at", System.currentTimeMillis())
    shown.put(t.alarmId, entry)
    // keep it small
    val keys = mutableListOf<String>()
    val iter = shown.keys()
    while (iter.hasNext()) keys.add(iter.next())
    if (keys.size > 30) {
      keys.sortBy { key -> shown.optJSONObject(key)?.optLong("at", 0L) ?: 0L }
      for (k in keys.take(keys.size - 30)) shown.remove(k)
    }
    Store.writeObject(ctx, Store.SHOWN, shown)
  }

  fun forgetShown(ctx: Context, alarmId: String) {
    val shown = loadShown(ctx)
    if (shown.has(alarmId)) {
      shown.remove(alarmId)
      Store.writeObject(ctx, Store.SHOWN, shown)
    }
  }

  fun toggleTask(ctx: Context, alarmId: String, taskId: String, occurrence: String) {
    val entry = loadShown(ctx).optJSONObject(alarmId)
    val trigger = entry?.optJSONObject("trigger")
    var current = false
    if (trigger != null) {
      val task = withPendingTicks(ctx, Trigger(trigger)).firstOrNull { it.optString("id", "") == taskId }
      current = task?.optBoolean("done", false) ?: false
    }
    val pending = loadPending(ctx)
    val old = pending.optJSONArray("toggles") ?: JSONArray()
    val next = JSONArray()
    for (i in 0 until old.length()) {
      val o = old.optJSONObject(i) ?: continue
      val same = o.optString("alarmId", "") == alarmId && o.optString("taskId", "") == taskId &&
        o.optString("occurrence", "") == occurrence
      if (!same) next.put(o)
    }
    val tick = JSONObject()
    tick.put("alarmId", alarmId)
    tick.put("taskId", taskId)
    tick.put("occurrence", occurrence)
    tick.put("done", !current)
    tick.put("at", System.currentTimeMillis())
    next.put(tick)
    pending.put("toggles", next)
    savePending(ctx, pending)
    if (entry != null) Notifs.redrawReminder(ctx, entry)
    RingEvents.emit("onPending", mapOf("kind" to "task"))
  }

  fun markDone(ctx: Context, alarmId: String, occurrence: String) {
    val pending = loadPending(ctx)
    val done = pending.optJSONArray("done") ?: JSONArray()
    val o = JSONObject()
    o.put("alarmId", alarmId)
    o.put("occurrence", occurrence)
    o.put("at", System.currentTimeMillis())
    done.put(o)
    pending.put("done", done)
    savePending(ctx, pending)
    Scheduler.dropOccurrence(ctx, alarmId, occurrence)
    Notifs.cancel(ctx, Notifs.notifId(alarmId))
    forgetShown(ctx, alarmId)
    RingEvents.emit("onPending", mapOf("kind" to "done"))
  }

  fun snoozeReminder(ctx: Context, alarmId: String) {
    val entry = loadShown(ctx).optJSONObject(alarmId) ?: return
    val trigger = entry.optJSONObject("trigger") ?: return
    val t = Trigger(trigger)
    val minutes = if (t.snoozeMinutes > 0) t.snoozeMinutes else 10
    val at = System.currentTimeMillis() + minutes * 60_000L
    val j = t.copyJson()
    j.put("id", t.alarmId + ":rsnooze:" + at)
    j.put("kind", "snooze")
    j.put("style", "notify")
    j.put("at", at)
    j.remove("wall")
    Scheduler.addSnooze(ctx, j)
    Scheduler.armNext(ctx)
    Notifs.showReminder(ctx, t, true, at)
  }

  /** JavaScript ticked tasks in the app: redraw the reminder on screen, if any. */
  fun updateShownTasks(ctx: Context, alarmId: String, tasksJson: String) {
    val shown = loadShown(ctx)
    val entry = shown.optJSONObject(alarmId) ?: return
    val trigger = entry.optJSONObject("trigger") ?: return
    trigger.put("tasks", JSONArray(tasksJson))
    entry.put("trigger", trigger)
    shown.put(alarmId, entry)
    Store.writeObject(ctx, Store.SHOWN, shown)
    Notifs.redrawReminder(ctx, entry)
  }

  fun dismiss(ctx: Context, alarmId: String) {
    Notifs.cancel(ctx, Notifs.notifId(alarmId))
    forgetShown(ctx, alarmId)
  }

  /** Hands the stored taps to JavaScript once; folds ticks into the reminders still on screen. */
  fun takePending(ctx: Context): String {
    val pending = loadPending(ctx)
    val toggles = pending.optJSONArray("toggles")
    if (toggles != null && toggles.length() > 0) {
      val shown = loadShown(ctx)
      val keys = shown.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        val entry = shown.optJSONObject(key) ?: continue
        val trigger = entry.optJSONObject("trigger") ?: continue
        val merged = JSONArray()
        for (task in withPendingTicks(ctx, Trigger(trigger))) merged.put(task)
        trigger.put("tasks", merged)
      }
      Store.writeObject(ctx, Store.SHOWN, shown)
    }
    Store.writeObject(ctx, Store.PENDING, null)
    return pending.toString()
  }
}
