import { PermissionsAndroid, Platform } from 'react-native';

import Native, {
  type NativeTrigger,
  type PendingActions,
  type Permissions,
  type RingState,
  type SoundOption,
} from '../../modules/celestial-alarm';
import { bump, success, wrong } from './haptics';
import { buildTriggers, currentOccurrence, tasksOf } from './schedule';
import type { Item } from './types';

/** False on web and on builds without the alarm engine. */
export const hasEngine = Native != null;

function has<K extends string>(name: K): boolean {
  return Native != null && typeof (Native as unknown as Record<string, unknown>)[name] === 'function';
}

export function syncSchedule(items: Item[]): number {
  if (!Native) return 0;
  try {
    return Native.setSchedule(JSON.stringify(buildTriggers(items)));
  } catch (e) {
    console.warn('Celestial: could not sync schedule', e);
    return 0;
  }
}

export function getRingState(): RingState | null {
  if (!Native) return null;
  try {
    const raw = JSON.parse(Native.getRingState()) as RingState;
    return { ...raw, trigger: raw.trigger ?? null };
  } catch {
    return null;
  }
}

export function snooze(): boolean {
  return Native ? Native.snooze() : false;
}

export function stopRinging(): void {
  Native?.stop();
}

export function setMissionMode(on: boolean): void {
  Native?.setMissionMode(on);
}

export function releaseLockScreen(moveToBack: boolean): void {
  Native?.releaseLockScreen(moveToBack);
}

export function cancelSnooze(alarmId: string): void {
  Native?.cancelSnooze(alarmId);
}

export function getPermissions(): Permissions | null {
  if (!Native) return null;
  try {
    return JSON.parse(Native.getPermissions()) as Permissions;
  } catch {
    return null;
  }
}

export function openSettings(which: 'notifications' | 'exactAlarms' | 'fullScreen' | 'battery' | 'app'): void {
  Native?.openSettings(which);
}

export async function requestNotifications(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 33) return true;
  const result = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

let soundCache: SoundOption[] | null = null;

export const BUNDLED_SOUNDS: SoundOption[] = [
  { id: 'raw:classic', title: 'Classic', group: 'loud' },
  { id: 'raw:buzzer', title: 'Buzzer', group: 'loud' },
  { id: 'raw:siren', title: 'Siren', group: 'loud' },
  { id: 'raw:bell', title: 'Bell', group: 'loud' },
  { id: 'raw:klaxon', title: 'Klaxon', group: 'loud' },
  { id: 'raw:beacon', title: 'Beacon', group: 'gentle' },
  { id: 'raw:rise', title: 'Rise', group: 'gentle' },
  { id: 'raw:chime', title: 'Chime', group: 'gentle' },
  { id: 'raw:drift', title: 'Drift', group: 'gentle' },
];

export async function loadSounds(): Promise<SoundOption[]> {
  if (soundCache) return soundCache;
  if (!Native) return BUNDLED_SOUNDS;
  try {
    const list = JSON.parse(await Native.getSounds()) as SoundOption[];
    // Our own sounds come from the known list; the phone's from the system.
    soundCache = [...BUNDLED_SOUNDS, ...list.filter((x) => x.group === 'phone')];
    return soundCache;
  } catch {
    return BUNDLED_SOUNDS;
  }
}

export function soundTitle(id: string): string {
  const all = soundCache ?? BUNDLED_SOUNDS;
  return all.find((s) => s.id === id)?.title ?? (id.startsWith('raw:') ? id.slice(4) : 'Phone sound');
}

export function previewSound(id: string): void {
  Native?.previewSound(id);
}

export function stopPreview(): void {
  Native?.stopPreview();
}

export function testRing(trigger: Partial<NativeTrigger>, seconds: number): boolean {
  if (!Native || !has('testRing')) return false;
  return Native.testRing(JSON.stringify(trigger), seconds);
}

export function isLocked(): boolean {
  return Native ? Native.isLocked() : false;
}

export function addRingListener(fn: () => void): () => void {
  if (!Native) return () => {};
  const a = Native.addListener('onRing', fn);
  return () => a.remove();
}

export function addRingEndListener(fn: (reason: string) => void): () => void {
  if (!Native) return () => {};
  const a = Native.addListener('onRingEnd', (e) => fn(e.reason));
  return () => a.remove();
}

export type Missed = { alarmId: string; at: number; kind: string; title: string };

export function getMissed(): Missed[] {
  if (!Native) return [];
  try {
    return JSON.parse(Native.getMissed()) as Missed[];
  } catch {
    return [];
  }
}

/** Ticks and "Mark done" taps from notifications since the last call. */
export function takePendingActions(): PendingActions | null {
  if (!Native || !has('takePendingActions')) return null;
  try {
    const p = JSON.parse(Native.takePendingActions()) as PendingActions;
    return p.toggles?.length || p.done?.length ? p : null;
  } catch {
    return null;
  }
}

/** Keep a reminder notification on screen in step with ticks made in the app. */
export function updateShownTasks(item: Item): void {
  if (!Native || !has('updateShownTasks')) return;
  const tasks = tasksOf(item, currentOccurrence(item)).map((l) => ({
    id: l.id,
    text: l.text,
    done: l.done,
    level: l.level,
  }));
  try {
    Native.updateShownTasks(item.id, JSON.stringify(tasks));
  } catch {
    // nothing on screen
  }
}

export function dismissReminder(alarmId: string): void {
  if (Native && has('dismissReminder')) Native.dismissReminder(alarmId);
}

/** Strong feedback for missions: the phone's vibrator at alarm strength when available. */
export function haptic(kind: 'success' | 'wrong' | 'tick'): void {
  if (Native && has('haptic')) {
    Native.haptic(kind);
    return;
  }
  if (kind === 'success') success();
  else if (kind === 'wrong') wrong();
  else bump();
}

export function addPendingListener(fn: () => void): () => void {
  if (!Native) return () => {};
  const a = Native.addListener('onPending', fn);
  return () => a.remove();
}
