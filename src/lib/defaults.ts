import { addDays, minutesOf, today as todayYmd } from './dates';
import type { Item, Kind, Mission, Snooze, SoundPrefs, Tag } from './types';

export const TAG_COLORS = ['#4C7DF0', '#27A567', '#EE8A35', '#D9548E', '#8B62E0', '#1FA3B5', '#C9A227', '#8A8797'];

export const DEFAULT_TAGS: Tag[] = [
  { id: 'mill', name: 'Mill', color: '#4C7DF0' },
  { id: 'hobbies', name: 'Hobbies', color: '#27A567' },
  { id: 'chores', name: 'Chores', color: '#EE8A35' },
];

export const DEFAULT_MISSION: Mission = { type: 'none', level: 3, rounds: 3, sentences: [] };
export const DEFAULT_SNOOZE: Snooze = { minutes: 10, times: 3 };
export const DEFAULT_SOUND: SoundPrefs = { main: 'raw:beacon', pre: 'raw:chime', rising: true, vibrate: true };
export const DEFAULT_GAP = 15;

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** A new alarm or reminder starts at the current time (next whole minute). */
export function newItem(kind: Kind, now: Date = new Date()): Item {
  const next = new Date(now.getTime() + 60_000 - (now.getTime() % 60_000));
  let date = todayYmd(next);
  let time = minutesOf(next);
  if (time >= 1440) {
    time -= 1440;
    date = addDays(date, 1);
  }
  const t = Date.now();
  return {
    id: uid('i'),
    kind,
    enabled: true,
    date,
    time,
    lead: 0,
    gap: DEFAULT_GAP,
    pins: [],
    name: '',
    lines: [],
    tagId: null,
    energy: null,
    repeat: 'once',
    custom: { freq: 'weekly', every: 1, weekdays: [], monthDays: [], months: [] },
    endRepeat: null,
    from: { kind: 'none' },
    until: { kind: 'event' },
    ringLikeAlarm: false,
    mission: { ...DEFAULT_MISSION },
    snooze: { ...DEFAULT_SNOOZE },
    sound: { ...DEFAULT_SOUND },
    done: [],
    createdAt: t,
    updatedAt: t,
  };
}

export const LEVEL_NAMES = ['Very easy', 'Easy', 'Normal', 'Hard', 'Very hard'];
