import { addDays, diffDays, pad, parseYmd, today as todayYmd } from './dates';
import type { CustomRepeat, Item, RepeatPreset, Unit, WindowFrom, WindowUntil } from './types';

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function normMinutes(m: number): number {
  return ((Math.round(m) % 1440) + 1440) % 1440;
}

/** 9:00 AM */
export function fmtTime(minutes: number): string {
  const m = normMinutes(minutes);
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(m % 60)} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** 9:00 (no AM/PM) */
export function fmtClock(minutes: number): string {
  const m = normMinutes(minutes);
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(m % 60)}`;
}

export function amPm(minutes: number): 'AM' | 'PM' {
  return normMinutes(minutes) < 720 ? 'AM' : 'PM';
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** Clock-based: morning 5–12, afternoon 12–17, evening 17–21, night 21–5. */
export function partOfDay(minutes: number): PartOfDay {
  const h = Math.floor(normMinutes(minutes) / 60);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

/** Tue 15 Dec (adds the year when it is not this year) */
export function fmtDate(day: string, now: Date = new Date()): string {
  const d = parseYmd(day);
  const base = `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Today / Tomorrow / Yesterday / Tue 15 Dec */
export function fmtDay(day: string, now: Date = new Date()): string {
  const t = todayYmd(now);
  if (day === t) return 'Today';
  if (day === addDays(t, 1)) return 'Tomorrow';
  if (day === addDays(t, -1)) return 'Yesterday';
  return fmtDate(day, now);
}

/** 8 – 22 Dec, or 28 Nov – 5 Dec */
export function fmtRange(from: string, to: string): string {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (from === to) return `${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
  }
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
}

/** 8 h 10 min · 45 min · 3 d 4 h · under 1 min */
export function fmtLeft(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 1) return 'under 1 min';
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${s}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

export const REPEAT_LABELS: Record<RepeatPreset, string> = {
  once: 'Once',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekends: 'Weekends',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  '3months': 'Every 3 months',
  '6months': 'Every 6 months',
  yearly: 'Yearly',
  custom: 'Custom',
};

/** "Rings every 2 weeks on Tuesday" */
export function customSummary(c: CustomRepeat, date: string, verb = 'Rings'): string {
  const every = Math.max(1, c.every || 1);
  const d = parseYmd(date);
  switch (c.freq) {
    case 'daily':
      return every === 1 ? `${verb} every day` : `${verb} every ${every} days`;
    case 'weekly': {
      const days = (c.weekdays.length ? c.weekdays : [d.getDay()])
        .slice()
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((w) => WEEKDAYS_LONG[w]);
      const unit = every === 1 ? 'every week' : `every ${every} weeks`;
      return `${verb} ${unit} on ${joinList(days)}`;
    }
    case 'monthly': {
      const dates = (c.monthDays.length ? c.monthDays : [d.getDate()])
        .slice()
        .sort((a, b) => a - b)
        .map(ordinal);
      const unit = every === 1 ? 'every month' : `every ${every} months`;
      return `${verb} ${unit} on the ${joinList(dates)}`;
    }
    case 'yearly': {
      const months = (c.months.length ? c.months : [d.getMonth()])
        .slice()
        .sort((a, b) => a - b)
        .map((m) => MONTHS_LONG[m]);
      const unit = every === 1 ? 'every year' : `every ${every} years`;
      return `${verb} ${unit} in ${joinList(months)} on the ${ordinal(d.getDate())}`;
    }
  }
  return '';
}

export function repeatLabel(item: Pick<Item, 'repeat' | 'custom' | 'date'>): string {
  if (item.repeat !== 'custom') return REPEAT_LABELS[item.repeat];
  const c = item.custom;
  const every = Math.max(1, c.every || 1);
  if (c.freq === 'weekly' && every === 1 && c.weekdays.length) {
    return c.weekdays
      .slice()
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      .map((w) => WEEKDAYS_SHORT[w])
      .join(' ');
  }
  return customSummary(c, item.date, '')
    .trim()
    .replace(/^every/, 'Every');
}

const UNIT_WORDS: Record<Unit, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
};

export function unitWord(n: number, unit: Unit): string {
  return `${n} ${UNIT_WORDS[unit][n === 1 ? 0 : 1]}`;
}

export function fromLabel(f: WindowFrom): string {
  return f.kind === 'none' ? 'None' : `${unitWord(f.n, f.unit)} before`;
}

export function untilLabel(u: WindowUntil, now: Date = new Date()): string {
  if (u.kind === 'event') return 'The event day';
  if (u.kind === 'date') return fmtDate(u.date, now);
  return `${unitWord(u.n, u.unit)} after`;
}

export function windowIsOff(item: Pick<Item, 'from' | 'until'>): boolean {
  return item.from.kind === 'none' && item.until.kind === 'event';
}

export function daysBetweenLabel(a: string, b: string): string {
  const n = diffDays(a, b);
  return n === 1 ? '1 day' : `${n} days`;
}
