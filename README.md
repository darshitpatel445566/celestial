# Celestial

A personal productivity app, rebuilt from zero. Part 1: **alarms and reminders with pre-alarms**.
Android first (Expo / React Native), iPhone and web later.

## What's in it

- **Editor** (`src/app/edit.tsx`): one page. Time readout with ‹ › minute nudges, date calendar,
  the timeline slider (drag ◆ for the time, pull ◀ left for pre-alarms counted back in gap steps,
  tap further left to pin one), gap wheel, name, description with checklists (`- ` task, `-- ` subtask),
  tags, energy, repeat (Apple presets + custom), end repeat, "Remind every day" (from/until around the
  event day), ring-like-an-alarm for reminders, mission, snooze and sound.
- **List** (`src/app/index.tsx`): Not done / Today / Tomorrow / Later / Off, filters by type and tag.
- **Ring screen** (`src/app/ring.tsx`): shows over the lock screen; snooze, stop through a mission
  (maths, tiles, typing), then the item's tasks.
- **Alarm engine** (`modules/celestial-alarm`, Kotlin): exact alarms (`setAlarmClock`), a foreground
  service that rings on the alarm stream with rising volume and vibration, full-screen notification,
  snooze and auto-snooze, reminders as notifications, re-arming after restart / update / clock change.
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
npm run sounds      # regenerate the four bundled alarm sounds (needs ffmpeg)
```
