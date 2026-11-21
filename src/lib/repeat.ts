import { addDays, daysInMonth, diffDays, parseYmd, weekStart, weekday } from './dates';
import type { Item } from './types';

type RepeatFields = Pick<Item, 'date' | 'repeat' | 'custom' | 'endRepeat'>;

function monthIndex(d: Date) {
  return d.getFullYear() * 12 + d.getMonth();
}

/** Same day of month every `interval` months; short months use their last day. */
function monthlyMatch(start: string, day: string, interval: number): boolean {
  const s = parseYmd(start);
  const d = parseYmd(day);
  const months = monthIndex(d) - monthIndex(s);
  if (months < 0 || months % interval !== 0) return false;
  const target = Math.min(s.getDate(), daysInMonth(d.getFullYear(), d.getMonth()));
  return d.getDate() === target;
}

function customMatch(item: RepeatFields, day: string): boolean {
  const c = item.custom;
  const every = Math.max(1, Math.floor(c.every || 1));
  const s = parseYmd(item.date);
  const d = parseYmd(day);
  switch (c.freq) {
    case 'daily':
      return diffDays(item.date, day) % every === 0;
    case 'weekly': {
      const days = c.weekdays.length ? c.weekdays : [s.getDay()];
      if (!days.includes(d.getDay())) return false;
      const weeks = Math.round(diffDays(weekStart(item.date), weekStart(day)) / 7);
      return weeks % every === 0;
    }
    case 'monthly': {
      const months = monthIndex(d) - monthIndex(s);
      if (months % every !== 0) return false;
      const dates = c.monthDays.length ? c.monthDays : [s.getDate()];
      return dates.includes(d.getDate());
    }
    case 'yearly': {
      const years = d.getFullYear() - s.getFullYear();
      if (years % every !== 0) return false;
      const months = c.months.length ? c.months : [s.getMonth()];
      if (!months.includes(d.getMonth())) return false;
      const target = Math.min(s.getDate(), daysInMonth(d.getFullYear(), d.getMonth()));
      return d.getDate() === target;
    }
  }
  return false;
}

/** Is `day` an event day (occurrence) of this item? */
export function isOccurrence(item: RepeatFields, day: string): boolean {
  if (day < item.date) return false;
  if (item.repeat !== 'once' && item.endRepeat && day > item.endRepeat) return false;
  switch (item.repeat) {
    case 'once':
      return day === item.date;
    case 'daily':
      return true;
    case 'weekdays': {
      const wd = weekday(day);
      return wd >= 1 && wd <= 5;
    }
    case 'weekends': {
      const wd = weekday(day);
      return wd === 0 || wd === 6;
    }
    case 'weekly':
      return diffDays(item.date, day) % 7 === 0;
    case 'fortnightly':
      return diffDays(item.date, day) % 14 === 0;
    case 'monthly':
      return monthlyMatch(item.date, day, 1);
    case '3months':
      return monthlyMatch(item.date, day, 3);
    case '6months':
      return monthlyMatch(item.date, day, 6);
    case 'yearly':
      return monthlyMatch(item.date, day, 12);
    case 'custom':
      return customMatch(item, day);
  }
  return false;
}

/** Event days between two days, inclusive. */
export function occurrencesBetween(item: RepeatFields, from: string, to: string): string[] {
  if (item.repeat === 'once') return item.date >= from && item.date <= to ? [item.date] : [];
  const out: string[] = [];
  let day = from < item.date ? item.date : from;
  let guard = 0;
  while (day <= to && guard < 3000) {
    if (isOccurrence(item, day)) out.push(day);
    day = addDays(day, 1);
    guard++;
  }
  return out;
}

/** First event day on or after `from`, searching up to `maxDays` ahead. */
export function nextOccurrence(item: RepeatFields, from: string, maxDays = 800): string | null {
  if (item.repeat === 'once') return item.date >= from ? item.date : null;
  let day = from < item.date ? item.date : from;
  for (let i = 0; i < maxDays; i++) {
    if (item.endRepeat && day > item.endRepeat) return null;
    if (isOccurrence(item, day)) return day;
    day = addDays(day, 1);
  }
  return null;
}

/** Last event day on or before `to`, searching up to `maxDays` back. */
export function previousOccurrence(item: RepeatFields, to: string, maxDays = 400): string | null {
  let day = to;
  for (let i = 0; i < maxDays; i++) {
    if (day < item.date) return null;
    if (isOccurrence(item, day)) return day;
    day = addDays(day, -1);
  }
  return null;
}
