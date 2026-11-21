package expo.modules.celestialalarm

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Hooks into the main activity so a ringing alarm can show over the lock screen, even on a cold start. */
class CelestialAlarmPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> {
    return listOf(LockScreenListener())
  }
}

class LockScreenListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    LockScreen.attach(activity)
    if (LockScreen.isRingIntent(activity.intent)) LockScreen.showForRing(activity, true)
  }

  override fun onResume(activity: Activity) {
    LockScreen.attach(activity)
    LockScreen.resumed = true
  }

  override fun onPause(activity: Activity) {
    LockScreen.resumed = false
  }

  override fun onDestroy(activity: Activity) {
    LockScreen.detach(activity)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    val activity = LockScreen.current() ?: return false
    if (LockScreen.isRingIntent(intent)) LockScreen.showForRing(activity, !LockScreen.resumed)
    return false
  }
}
