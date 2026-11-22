package expo.modules.celestialalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Date

internal object Notifs {
  // Android gives an expanded custom notification about 256 dp: title, due line, 5 rows and "+N more" fit.
  private const val MAX_TASKS = 5

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

  private fun builder(ctx: Context, channel: String, color: Int): Notification.Builder {
    ensureChannels(ctx)
    val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, channel) else Notification.Builder(ctx)
    b.setSmallIcon(R.drawable.celestial_notification)
    b.setColor(color)
    return b
  }

  private fun ringPendingIntent(ctx: Context, triggerId: String): PendingIntent {
    val intent = Intents.deepLink(ctx, "celestial://ring?t=" + Uri.encode(triggerId), true)
    return PendingIntent.getActivity(ctx, C.REQ_RING, intent, Intents.FLAGS)
  }

  private fun openItemIntent(ctx: Context, alarmId: String): PendingIntent {
    val url = "celestial://item?id=" + Uri.encode(alarmId)
    return PendingIntent.getActivity(ctx, notifId(alarmId), Intents.deepLink(ctx, url, false), Intents.FLAGS)
  }

  fun buildRing(ctx: Context, t: Trigger?, snoozesLeft: Int): Notification {
    val full = ringPendingIntent(ctx, t?.id ?: "")
    val b = builder(ctx, C.CH_RING, t?.color ?: C.YELLOW)
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
        b.addAction(action(ctx, "Dismiss", C.ACTION_DISMISS, "ring"))
      } else if (snoozesLeft > 0) {
        b.addAction(action(ctx, "Snooze " + t.snoozeMinutes + " min", C.ACTION_SNOOZE, "ring"))
      }
    }
    return b.build()
  }

  private fun action(ctx: Context, label: String, act: String, key: String): Notification.Action {
    val pi = PendingIntent.getBroadcast(ctx, 0, Intents.action(ctx, act, key), Intents.FLAGS)
    val icon = Icon.createWithResource(ctx, R.drawable.celestial_notification)
    return Notification.Action.Builder(icon, label, pi).build()
  }

  private fun alarmAction(ctx: Context, label: String, act: String, t: Trigger): Notification.Action {
    val intent = Intents.action(ctx, act, t.alarmId)
    intent.putExtra(C.EXTRA_ALARM, t.alarmId)
    intent.putExtra(C.EXTRA_OCCURRENCE, t.occurrence)
    val pi = PendingIntent.getBroadcast(ctx, 0, intent, Intents.FLAGS)
    val icon = Icon.createWithResource(ctx, R.drawable.celestial_notification)
    return Notification.Action.Builder(icon, label, pi).build()
  }

  fun notifId(alarmId: String): Int = 10000 + (alarmId.hashCode() and 0x3FFFFFF)

  /**
   * A reminder: title, due line (red when overdue), its tasks as a list you can tick right here,
   * and Mark done / Snooze buttons. `snoozedUntil` > 0 shows a live countdown instead.
   */
  fun showReminder(ctx: Context, t: Trigger, silent: Boolean = false, snoozedUntil: Long = 0L) {
    val tasks = Actions.withPendingTicks(ctx, t)
    val done = tasks.count { it.optBoolean("done", false) }
    val snoozed = snoozedUntil > System.currentTimeMillis()
    val dueLine = if (snoozed) {
      "Snoozed · again at " + android.text.format.DateFormat.getTimeFormat(ctx).format(Date(snoozedUntil))
    } else {
      t.due
    }
    val summary = if (tasks.isEmpty()) dueLine else dueLine + " · " + done + "/" + tasks.size + " done"

    val b = builder(ctx, C.CH_REMIND, t.color)
    b.setContentTitle(t.title)
    b.setContentText(summary)
    b.setCategory(Notification.CATEGORY_REMINDER)
    b.setAutoCancel(false)
    b.setContentIntent(openItemIntent(ctx, t.alarmId))
    b.setOnlyAlertOnce(silent)
    if (snoozed) {
      b.setUsesChronometer(true)
      b.setChronometerCountDown(true)
      b.setWhen(snoozedUntil)
      b.setShowWhen(true)
    } else {
      b.setWhen(t.timeMillis)
      b.setShowWhen(true)
    }
    if (Build.VERSION.SDK_INT < 26 && !silent) {
      b.setPriority(Notification.PRIORITY_HIGH)
      b.setDefaults(Notification.DEFAULT_ALL)
    }

    if (tasks.isNotEmpty()) {
      val small = RemoteViews(ctx.packageName, R.layout.celestial_notif_small)
      small.setTextViewText(R.id.celestial_title, t.title)
      small.setTextViewText(R.id.celestial_due, summary)
      if (t.overdue && !snoozed) small.setTextColor(R.id.celestial_due, C.RED)

      val big = RemoteViews(ctx.packageName, R.layout.celestial_notif_tasks)
      big.setTextViewText(R.id.celestial_title, t.title)
      big.setTextViewText(R.id.celestial_due, dueLine)
      if (t.overdue && !snoozed) big.setTextColor(R.id.celestial_due, C.RED)
      big.removeAllViews(R.id.celestial_tasks)
      val indent = (24 * ctx.resources.displayMetrics.density).toInt()
      for (task in tasks.take(MAX_TASKS)) {
        val row = RemoteViews(ctx.packageName, R.layout.celestial_notif_task)
        val isDone = task.optBoolean("done", false)
        row.setImageViewResource(
          R.id.celestial_check,
          if (isDone) R.drawable.celestial_check_on else R.drawable.celestial_check_off
        )
        val text = task.optString("text", "")
        if (isDone) {
          val span = SpannableString(text)
          span.setSpan(StrikethroughSpan(), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          row.setTextViewText(R.id.celestial_task_text, span)
        } else {
          row.setTextViewText(R.id.celestial_task_text, text)
        }
        row.setViewPadding(R.id.celestial_task_row, if (task.optInt("level", 0) == 1) indent else 0, 0, 0, 0)
        val intent = Intents.action(ctx, C.ACTION_TASK, t.alarmId + "/" + task.optString("id", ""))
        intent.putExtra(C.EXTRA_ALARM, t.alarmId)
        intent.putExtra(C.EXTRA_TASK, task.optString("id", ""))
        intent.putExtra(C.EXTRA_OCCURRENCE, t.occurrence)
        row.setOnClickPendingIntent(
          R.id.celestial_task_row,
          PendingIntent.getBroadcast(ctx, 0, intent, Intents.FLAGS)
        )
        big.addView(R.id.celestial_tasks, row)
      }
      val more = tasks.size - MAX_TASKS
      if (more > 0) {
        big.setTextViewText(R.id.celestial_more, "+" + more + " more in the app")
        big.setViewVisibility(R.id.celestial_more, android.view.View.VISIBLE)
      }
      b.setStyle(Notification.DecoratedCustomViewStyle())
      b.setCustomContentView(small)
      b.setCustomBigContentView(big)
    } else {
      b.setStyle(Notification.BigTextStyle().bigText(if (snoozed) dueLine else t.body))
    }

    if (t.canDone) b.addAction(alarmAction(ctx, "Mark done", C.ACTION_DONE, t))
    if (!snoozed) b.addAction(alarmAction(ctx, "Snooze " + t.snoozeMinutes + " min", C.ACTION_REMIND_SNOOZE, t))

    try {
      manager(ctx).notify(notifId(t.alarmId), b.build())
      Actions.rememberShown(ctx, t, snoozedUntil)
    } catch (e: Exception) {
      // notifications not allowed
    }
  }

  /** Snoozed alarm: shows a live countdown until it rings again. */
  fun showSnoozed(ctx: Context, t: Trigger, until: Long, auto: Boolean) {
    val time = android.text.format.DateFormat.getTimeFormat(ctx).format(Date(until))
    val open = PendingIntent.getActivity(ctx, C.REQ_SHOW, Intents.open(ctx), Intents.FLAGS)
    val b = builder(ctx, C.CH_STATUS, t.color)
    b.setContentTitle(t.title)
    b.setContentText((if (auto) "Not answered. " else "") + "Rings again at " + time)
    b.setOngoing(true)
    b.setContentIntent(open)
    b.setUsesChronometer(true)
    b.setChronometerCountDown(true)
    b.setWhen(until)
    b.setShowWhen(true)
    try {
      manager(ctx).notify(C.NOTIF_SNOOZE, b.build())
    } catch (e: Exception) {
      // notifications not allowed
    }
  }

  /** Backup when the ring service cannot start: a loud alarm-channel notification. */
  fun showFallback(ctx: Context, t: Trigger) {
    val full = ringPendingIntent(ctx, t.id)
    val b = builder(ctx, C.CH_FALLBACK, t.color)
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

  /** Redraws the reminder for this alarm after a tick, without sound. */
  fun redrawReminder(ctx: Context, shown: JSONObject) {
    val trigger = shown.optJSONObject("trigger") ?: return
    showReminder(ctx, Trigger(trigger), true, shown.optLong("snoozedUntil", 0L))
  }
}
