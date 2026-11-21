export type Kind = 'alarm' | 'reminder';

export type RepeatPreset =
  | 'once'
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'fortnightly'
  | 'monthly'
  | '3months'
  | '6months'
  | 'yearly'
  | 'custom';

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type CustomRepeat = {
  freq: Freq;
  every: number;
  /** 0 = Sunday … 6 = Saturday (weekly) */
  weekdays: number[];
  /** 1–31 (monthly) */
  monthDays: number[];
  /** 0 = January … 11 = December (yearly) */
  months: number[];
};

export type Unit = 'day' | 'week' | 'month';

/** "Remind every day" start, counted back from the event day. */
export type WindowFrom = { kind: 'none' } | { kind: 'before'; n: number; unit: Unit };

/** "Remind every day" end. 'date' only for one-time items. */
export type WindowUntil = { kind: 'event' } | { kind: 'after'; n: number; unit: Unit } | { kind: 'date'; date: string };

export type Line = {
  id: string;
  text: string;
  type: 'text' | 'task';
  level: 0 | 1;
  done: boolean;
};

export type MissionType = 'none' | 'maths' | 'tiles' | 'typing';

export type Mission = {
  type: MissionType;
  /** 1–5 */
  level: number;
  rounds: number;
  /** The user's own typing sentences; empty = built-in ones */
  sentences: string[];
};

export type Snooze = {
  minutes: number;
  /** 0 = snooze off */
  times: number;
};

export type SoundPrefs = {
  main: string;
  pre: string;
  rising: boolean;
  vibrate: boolean;
};

/** 0 = empty battery … 3 = full; null = not set */
export type Energy = 0 | 1 | 2 | 3 | null;

export type Item = {
  id: string;
  kind: Kind;
  enabled: boolean;
  /** Event day of the first occurrence, "yyyy-mm-dd" */
  date: string;
  /** Minutes after midnight, 0–1439 */
  time: number;
  /** Pre-alarm lead in minutes (a multiple of gap); 0 = none */
  lead: number;
  /** Minutes between pre-alarms */
  gap: number;
  /** Extra pinned pre-alarms, minutes before the alarm */
  pins: number[];
  name: string;
  lines: Line[];
  tagId: string | null;
  energy: Energy;
  repeat: RepeatPreset;
  custom: CustomRepeat;
  /** Last occurrence day (inclusive), "yyyy-mm-dd"; null = never ends */
  endRepeat: string | null;
  from: WindowFrom;
  until: WindowUntil;
  /** Reminders only: ring with sound, mission and snooze like an alarm */
  ringLikeAlarm: boolean;
  mission: Mission;
  snooze: Snooze;
  sound: SoundPrefs;
  /** Occurrence days ticked as done */
  done: string[];
  /** Occurrence the task ticks belong to (repeating items start each occurrence fresh) */
  tasksFor?: string;
  createdAt: number;
  updatedAt: number;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
};
