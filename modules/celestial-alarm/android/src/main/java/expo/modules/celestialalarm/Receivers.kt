package expo.modules.celestialalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Fires when an armed alarm time arrives, and handles the notification buttons. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val ctx = context.applicationContext
    when (intent.action) {
      C.ACTION_FIRE -> {
        val due = Scheduler.takeDue(ctx)
        Scheduler.armNext(ctx)
        for (t in due) Ringer.deliver(ctx, t)
      }
      C.ACTION_SNOOZE -> {
        val service = RingService.instance
        if (service != null) {
          service.snooze(false)
        } else if (!Ringer.scheduleSnooze(ctx, false)) {
          Ringer.stopWithoutService(ctx)
        }
      }
      C.ACTION_DISMISS -> {
        val service = RingService.instance
        if (service != null) service.dismissPre() else Ringer.stopWithoutService(ctx)
      }
      C.ACTION_TASK -> {
        val alarmId = intent.getStringExtra(C.EXTRA_ALARM) ?: return
        val taskId = intent.getStringExtra(C.EXTRA_TASK) ?: return
        Actions.toggleTask(ctx, alarmId, taskId, intent.getStringExtra(C.EXTRA_OCCURRENCE) ?: "")
      }
      C.ACTION_DONE -> {
        val alarmId = intent.getStringExtra(C.EXTRA_ALARM) ?: return
        Actions.markDone(ctx, alarmId, intent.getStringExtra(C.EXTRA_OCCURRENCE) ?: "")
      }
      C.ACTION_REMIND_SNOOZE -> {
        val alarmId = intent.getStringExtra(C.EXTRA_ALARM) ?: return
        Actions.snoozeReminder(ctx, alarmId)
      }
    }
  }
}

/**
 * After a restart, an app update or a clock change, Android forgets armed alarms: arm the next one again.
 * If the phone restarted in the middle of a ringing alarm, it rings again a few seconds later.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val ctx = context.applicationContext
    val action = intent.action
    val clockChange = action == Intent.ACTION_TIME_CHANGED || action == Intent.ACTION_TIMEZONE_CHANGED
    if (!clockChange && RingService.instance == null && RingState.isRinging(ctx)) {
      val t = RingState.trigger(ctx)
      RingState.clear(ctx)
      if (t != null) {
        val now = System.currentTimeMillis()
        val j = t.copyJson()
        j.put("id", t.alarmId + ":resume:" + now)
        j.put("at", now + 3000L)
        j.remove("wall")
        Scheduler.addSnooze(ctx, j)
      }
    }
    Scheduler.armNext(ctx)
  }
}
