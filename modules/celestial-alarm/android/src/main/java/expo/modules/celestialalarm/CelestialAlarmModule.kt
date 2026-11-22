package expo.modules.celestialalarm

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The bridge JavaScript uses. JavaScript computes the schedule; this side stores it,
 * arms exact alarms, rings, snoozes and reports state. Complex values travel as JSON strings.
 */
class CelestialAlarmModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "Celestial: React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("CelestialAlarm")

    Events("onRing", "onRingEnd", "onReminder", "onPending")

    OnCreate {
      RingEvents.listener = { name, body -> sendEvent(name, body) }
      try {
        Notifs.ensureChannels(context)
      } catch (e: Exception) {
        // channels are created again before the first notification
      }
    }

    OnDestroy {
      RingEvents.listener = null
    }

    // Replaces all upcoming triggers. Returns when the next alarm is armed (ms), 0 if none.
    Function("setSchedule") { json: String ->
      Scheduler.setSchedule(context, json)
      Scheduler.armedAt(context).toDouble()
    }

    Function("getArmedAt") {
      Scheduler.armedAt(context).toDouble()
    }

    Function("cancelSnooze") { alarmId: String ->
      Scheduler.cancelSnooze(context, alarmId)
      val state = RingState.load(context)
      if (state.optBoolean("snoozed", false) && RingState.trigger(context)?.alarmId == alarmId) {
        RingState.clear(context)
      }
      Notifs.cancel(context, C.NOTIF_SNOOZE)
      true
    }

    Function("getRingState") {
      RingState.toJson(context)
    }

    Function("snooze") {
      val service = RingService.instance
      if (service != null) service.snooze(false) else Ringer.scheduleSnooze(context, false)
    }

    Function("stop") {
      val service = RingService.instance
      if (service != null) service.stopAlarm() else Ringer.stopWithoutService(context)
      true
    }

    Function("setMissionMode") { on: Boolean ->
      RingState.setMission(context, on)
      RingService.instance?.setMissionMode(on)
      true
    }

    Function("releaseLockScreen") { moveToBack: Boolean ->
      LockScreen.release(moveToBack)
      true
    }

    Function("isLocked") {
      LockScreen.isLocked(context)
    }

    Function("getPermissions") {
      Perms.status(context)
    }

    Function("openSettings") { which: String ->
      Perms.open(context, which)
    }

    AsyncFunction("getSounds") {
      Sounds.list(context)
    }

    Function("previewSound") { id: String ->
      Sounds.preview(context, id)
      true
    }

    Function("stopPreview") {
      Sounds.stopPreview()
      true
    }

    Function("getMissed") {
      val list = Store.readList(context, Store.MISSED)
      "[" + list.joinToString(",") { it.toString() } + "]"
    }

    Function("clearMissed") {
      Store.writeList(context, Store.MISSED, emptyList())
      true
    }

    // Ticks / "Mark done" from notifications since the last call, as JSON {toggles, done}.
    Function("takePendingActions") {
      Actions.takePending(context)
    }

    // Tasks ticked in the app: redraw the reminder notification if it is on screen.
    Function("updateShownTasks") { alarmId: String, tasksJson: String ->
      Actions.updateShownTasks(context, alarmId, tasksJson)
      true
    }

    Function("dismissReminder") { alarmId: String ->
      Actions.dismiss(context, alarmId)
      true
    }

    // Strong, reliable buzz for missions: "success", "wrong" or "tick".
    Function("haptic") { kind: String ->
      Haptic.play(context, kind)
      true
    }

    // Rings the given trigger after a few seconds, for testing.
    Function("testRing") { json: String, seconds: Int ->
      Ringer.scheduleTest(context, json, seconds)
      true
    }
  }
}
