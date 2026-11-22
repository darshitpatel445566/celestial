export type RingEventPayload = { trigger: string };
export type RingEndPayload = { reason: 'stopped' | 'snooze' | 'autoSnooze' | 'dismissed' | 'timeout'; until?: number };

export type CelestialAlarmModuleEvents = {
  onRing: (params: RingEventPayload) => void;
  onRingEnd: (params: RingEndPayload) => void;
  onReminder: (params: RingEventPayload) => void;
  /** A task was ticked or "Mark done" tapped in a notification */
  onPending: (params: { kind: 'task' | 'done' }) => void;
};

export type NotificationTask = { id: string; text: string; done: boolean; level: 0 | 1 };

/** Taps on notifications that JavaScript applies to its alarms. */
export type PendingActions = {
  toggles?: { alarmId: string; taskId: string; occurrence: string; done: boolean; at: number }[];
  done?: { alarmId: string; occurrence: string; at: number }[];
};

/** Exactly what the native side stores per upcoming ring. */
export type NativeTrigger = {
  id: string;
  alarmId: string;
  /** main = the alarm itself, pre = slider pre-alarm, window = "remind every day", snooze */
  kind: 'main' | 'pre' | 'window' | 'snooze';
  /** ring = full alarm, pre = gentle one-tap pre-alarm, notify = notification only */
  style: 'ring' | 'pre' | 'notify';
  /** Local wall-clock time "yyyy-MM-dd HH:mm" */
  wall: string;
  /** Same moment in epoch ms (used only if wall is missing) */
  at: number;
  title: string;
  body: string;
  sound: string;
  rising: boolean;
  vibrate: boolean;
  ringMinutes: number;
  snoozeMinutes: number;
  snoozeLimit: number;
  snoozeCount?: number;
  /** Event (occurrence) date "yyyy-MM-dd" this trigger belongs to */
  occurrence: string;
  last?: boolean;
  /** Colours: yellow for alarms, blue for reminders */
  itemKind?: 'alarm' | 'reminder';
  /** Checklist shown (and tickable) in reminder notifications */
  tasks?: NotificationTask[];
  /** "Due Tue 15 Dec · 9:00 AM" */
  due?: string;
  /** Past the event day: shown in red */
  overdue?: boolean;
  /** Offer "Mark done" in the notification */
  canDone?: boolean;
};

export type RingState = {
  ringing: boolean;
  snoozed: boolean;
  trigger: NativeTrigger | null;
  snoozeCount: number;
  snoozedUntil: number;
  startedAt: number;
  missionMode: boolean;
  serviceAlive: boolean;
};

export type Permissions = {
  notifications: boolean;
  exactAlarms: boolean;
  fullScreen: boolean;
  battery: boolean;
  sdk: number;
  manufacturer: string;
  model: string;
};

export type SoundOption = { id: string; title: string; group: 'loud' | 'gentle' | 'phone' };
