package expo.modules.celestialalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import java.util.Date

internal object Notifs {
  private val YELLOW: Int = 0xFFFFC93D.toInt()

  fun manager(ctx: Context): NotificationManager =
    ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = manager(ctx)
    if (nm.getNotificationChannel(C.CH_RING) == null) {
      val ch = NotificationChannel(C.CH_RING, "Alarms ringing", NotificationManager.IMPORTANCE_HIGH)
      ch.description = "Shows a ringing alarm, also on the lock screen"
      ch.setSound(null, null)
      ch.enableVibration(false)
      ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      ch.setBypassDnd(true)
      nm.createNotificationChannel(ch)
    }
    if (nm.getNotificationChannel(C.CH_REMIND) == null) {
      val ch = NotificationChannel(C.CH_REMIND, "Reminders", NotificationManager.IMPORTANCE_HIGH)
      ch.description = "Reminders and pre-reminders"
      ch.enableVibration(true)
      ch.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      nm.createNotificationChannel(ch)
    }
    if (nm.getNotificationChannel(C.CH_STATUS) == null) {
      val ch = NotificationChannel(C.CH_STATUS, "Snoozed alarms", NotificationManager.IMPORTANCE_LOW)
      ch.description = "Shows when a snoozed alarm will ring again"
      ch.setSound(null, null)
      ch.enableVibration(false)
      nm.createNotificationChannel(ch)
    }
    if (nm.getNotificationChannel(C.CH_FALLBACK) == null) {
      val ch = NotificationChannel(C.CH_FALLBACK, "Alarm backup", NotificationManager.IMPORTANCE_HIGH)
      ch.description = "Used only if the ringing screen cannot start"
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), attrs)
      ch.enableVibration(true)
      ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      ch.setBypassDnd(true)
      nm.createNotificationChannel(ch)
    }
  }

  private fun builder(ctx: Context, channel: String): Notification.Builder {
    ensureChannels(ctx)
    val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, channel) else Notification.Builder(ctx)
    b.setSmallIcon(R.drawable.celestial_notification)
    b.setColor(YELLOW)
    return b
  }

  private fun ringPendingIntent(ctx: Context, triggerId: String): PendingIntent {
    val intent = Intents.deepLink(ctx, "celestial://ring?t=" + Uri.encode(triggerId), true)
    return PendingIntent.getActivity(ctx, C.REQ_RING, intent, Intents.FLAGS)
  }

  fun buildRing(ctx: Context, t: Trigger?, snoozesLeft: Int): Notification {
    val full = ringPendingIntent(ctx, t?.id ?: "")
    val b = builder(ctx, C.CH_RING)
    b.setContentTitle(t?.title ?: "Alarm")
    b.setContentText(t?.body ?: "")
    b.setCategory(Notification.CATEGORY_ALARM)
    b.setOngoing(true)
    b.setAutoCancel(false)
    b.setVisibility(Notification.VISIBILITY_PUBLIC)
    b.setFullScreenIntent(full, true)
    b.setContentIntent(full)
    b.setShowWhen(false)
    if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_MAX)
    if (t != null) {
      if (t.style == "pre") {
        b.addAction(action(ctx, "Dismiss", C.ACTION_DISMISS, C.REQ_DISMISS))
      } else if (snoozesLeft > 0) {
        b.addAction(action(ctx, "Snooze " + t.snoozeMinutes + " min", C.ACTION_SNOOZE, C.REQ_SNOOZE))
      }
    }
    return b.build()
  }

  private fun action(ctx: Context, label: String, act: String, req: Int): Notification.Action {
    val intent = Intent(ctx, AlarmReceiver::class.java)
    intent.setAction(act)
    val pi = PendingIntent.getBroadcast(ctx, req, intent, Intents.FLAGS)
    val icon = Icon.createWithResource(ctx, R.drawable.celestial_notification)
    return Notification.Action.Builder(icon, label, pi).build()
  }

  fun notifId(alarmId: String): Int = 10000 + (alarmId.hashCode() and 0x3FFFFFF)

  fun showReminder(ctx: Context, t: Trigger) {
    val url = "celestial://item?id=" + Uri.encode(t.alarmId)
    val open = PendingIntent.getActivity(ctx, notifId(t.alarmId), Intents.deepLink(ctx, url, false), Intents.FLAGS)
    val b = builder(ctx, C.CH_REMIND)
    b.setContentTitle(t.title)
    b.setContentText(t.body)
    b.setStyle(Notification.BigTextStyle().bigText(t.body))
    b.setCategory(Notification.CATEGORY_REMINDER)
    b.setAutoCancel(true)
    b.setContentIntent(open)
    b.setWhen(t.timeMillis)
    b.setShowWhen(true)
    if (Build.VERSION.SDK_INT < 26) {
      b.setPriority(Notification.PRIORITY_HIGH)
      b.setDefaults(Notification.DEFAULT_ALL)
    }
    try {
      manager(ctx).notify(notifId(t.alarmId), b.build())
    } catch (e: Exception) {
      // notifications not allowed
    }
  }

  fun showSnoozed(ctx: Context, t: Trigger, until: Long, auto: Boolean) {
    val time = android.text.format.DateFormat.getTimeFormat(ctx).format(Date(until))
    val open = PendingIntent.getActivity(ctx, C.REQ_SHOW, Intents.open(ctx), Intents.FLAGS)
    val b = builder(ctx, C.CH_STATUS)
    b.setContentTitle(t.title)
    b.setContentText((if (auto) "Not answered. " else "") + "Snoozed until " + time)
    b.setOngoing(true)
    b.setContentIntent(open)
    b.setShowWhen(false)
    try {
      manager(ctx).notify(C.NOTIF_SNOOZE, b.build())
    } catch (e: Exception) {
      // notifications not allowed
    }
  }

  /** Backup when the ring service cannot start: a loud alarm-channel notification. */
  fun showFallback(ctx: Context, t: Trigger) {
    val full = ringPendingIntent(ctx, t.id)
    val b = builder(ctx, C.CH_FALLBACK)
    b.setContentTitle(t.title)
    b.setContentText(t.body)
    b.setCategory(Notification.CATEGORY_ALARM)
    b.setFullScreenIntent(full, true)
    b.setContentIntent(full)
    b.setAutoCancel(true)
    if (Build.VERSION.SDK_INT < 26) {
      b.setPriority(Notification.PRIORITY_MAX)
      b.setDefaults(Notification.DEFAULT_ALL)
    }
    try {
      manager(ctx).notify(C.NOTIF_FALLBACK, b.build())
    } catch (e: Exception) {
      // notifications not allowed
    }
  }

  fun cancel(ctx: Context, id: Int) {
    try {
      manager(ctx).cancel(id)
    } catch (e: Exception) {
      // ignore
    }
  }
}
