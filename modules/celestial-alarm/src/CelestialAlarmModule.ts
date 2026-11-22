import { NativeModule, requireOptionalNativeModule } from 'expo';

import { CelestialAlarmModuleEvents } from './CelestialAlarm.types';

declare class CelestialAlarmNative extends NativeModule<CelestialAlarmModuleEvents> {
  setSchedule(json: string): number;
  getArmedAt(): number;
  cancelSnooze(alarmId: string): boolean;
  getRingState(): string;
  snooze(): boolean;
  stop(): boolean;
  setMissionMode(on: boolean): boolean;
  releaseLockScreen(moveToBack: boolean): boolean;
  isLocked(): boolean;
  getPermissions(): string;
  openSettings(which: string): boolean;
  getSounds(): Promise<string>;
  previewSound(id: string): boolean;
  stopPreview(): boolean;
  getMissed(): string;
  clearMissed(): boolean;
  testRing(json: string, seconds: number): boolean;
  takePendingActions(): string;
  updateShownTasks(alarmId: string, tasksJson: string): boolean;
  dismissReminder(alarmId: string): boolean;
  haptic(kind: 'success' | 'wrong' | 'tick'): boolean;
}

// Optional so the app still opens where the module is missing (web preview, iPhone later).
export default requireOptionalNativeModule<CelestialAlarmNative>('CelestialAlarm');
