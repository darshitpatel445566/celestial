# Celestial

A personal productivity app, rebuilt from zero. Part 1: **alarms and reminders with pre-alarms**.
Android first (Expo / React Native), iPhone and web later.

## What's in it

- **Editor** (`src/app/edit.tsx`): one page. iPhone-style time wheel (always open; a time already
  passed today rings tomorrow), date calendar popup, the timeline slider (drag ◆ for the time, pull ◀
  left for pre-alarms counted back in gap steps, tap further left to pin one), gap wheel, name,
  description with checklists (`- ` task, `-- ` subtask), tags, energy, repeat (popup list + custom),
  end repeat, "Remind every day" (from/until around the event day), ring-like-an-alarm for reminders,
  mission, snooze wheels and sound lists. Reminders wear blue where alarms wear yellow.
- **Home** (`src/app/index.tsx`): Alarms | Tasks switch, + button for a new alarm or reminder.
  Alarms: Not done / Today / Tomorrow / Later / Off, filters by type and tag. Tasks: every task from
  every item, grouped Overdue / Today / Tomorrow / Later, ticked ones under Done.
- **Ring screen** (`src/app/ring.tsx`): shows over the lock screen; snooze, slide to stop (through a
  mission: maths, tiles, typing), "View tasks" quiets the alarm for a minute, then the item's tasks.
- **Reusable controls** (`src/ui`): `Wheel` (iPhone-style picker with a click per step), popup lists,
  popovers, slide-to-confirm, segmented switch.
- **Alarm engine** (`modules/celestial-alarm`, Kotlin): exact alarms (`setAlarmClock`), a foreground
  service that rings on the alarm stream with rising volume and vibration, full-screen notification,
  snooze and auto-snooze with a live countdown, reminders as notifications with a tickable checklist
  and Mark done / Snooze buttons, re-arming after restart / update / clock change.
- **Schedule logic** (`src/lib/schedule.ts`, `src/lib/repeat.ts`): JavaScript computes every upcoming
  ring and hands the list to the engine. Tested in `tests/schedule.test.ts`.

## Shipping to the phone

Every push to `main` runs `.eas/workflows/ship-android.yml` on Expo:

- native code changed → a new APK is built (`preview` profile, installable without the Play Store);
- only JavaScript changed → an over-the-air update is published to the installed APK.

Open the build on expo.dev on the phone to install it. Updates download in the background; the app
offers a Restart when one is ready (Settings → Check for update also works).

## Commands

```bash
npm test            # schedule tests
npm run typecheck   # TypeScript
npx eslint src      # lint
npm run sounds      # regenerate the bundled alarm sounds (needs ffmpeg)
```
