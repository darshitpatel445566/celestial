import type { NativeTrigger } from '../../modules/celestial-alarm';
import { addDays, addMonths, atTime, diffDays, today as todayYmd, wallClock } from './dates';
import { fmtDate, fmtLeft, fmtTime } from './format';
import { nextOccurrence, occurrencesBetween, previousOccurrence } from './repeat';
import type { Item, Line, Unit } from './types';

/** How far ahead the phone keeps exact triggers. Every app open refreshes it. */
export const HORIZON_DAYS = 21;
const MAX_TRIGGERS = 1200;

const unitDays = (n: number, unit: Unit) => (unit === 'day' ? n : unit === 'week' ? 7 * n : 31 * n);

/** Days before the event that "Remind every day" starts. */
export function fromDays(item: Pick<Item, 'from'>, occurrence: string): number {
  const f = item.from;
  if (f.kind === 'none') return 0;
  if (f.unit === 'month') return Math.max(0, diffDays(addMonths(occurrence, -f.n), occurrence));
  return Math.max(0, f.unit === 'week' ? 7 * f.n : f.n);
}

/** Last day that "Remind every day" rings for this occurrence. */
export function untilDay(item: Pick<Item, 'until' | 'repeat'>, occurrence: string): string {
  const u = item.until;
  if (u.kind === 'event') return occurrence;
  if (u.kind === 'date') {
    if (item.repeat !== 'once') return occurrence;
    return u.date > occurrence ? u.date : occurrence;
  }
  if (u.unit === 'month') return addMonths(occurrence, u.n);
  return addDays(occurrence, u.unit === 'week' ? 7 * u.n : u.n);
}

function maxAfterSpan(item: Item): number {
  const u = item.until;
  if (u.kind === 'event') return 0;
  if (u.kind === 'date') return Math.max(0, diffDays(item.date, u.date));
  return unitDays(u.n, u.unit);
}

function maxBeforeSpan(item: Item): number {
  const f = item.from;
  return f.kind === 'none' ? 0 : unitDays(f.n, f.unit);
}

/** Pre-alarm offsets in minutes before the alarm, counted back from it in gap steps, plus pins. */
export function preOffsets(item: Pick<Item, 'lead' | 'gap' | 'pins'>): number[] {
  const set = new Set<number>();
  if (item.gap > 0) {
    for (let k = 1; k * item.gap <= item.lead; k++) set.add(k * item.gap);
  }
  for (const p of item.pins) if (p > 0) set.add(Math.round(p));
  return [...set].sort((a, b) => b - a);
}

export type Planned = {
  at: Date;
  kind: 'main' | 'pre' | 'window';
  phase: 'before' | 'event' | 'after';
  occurrence: string;
  last: boolean;
};

/** Every ring of one occurrence: window days before, pre-alarms, the alarm, window days after. */
export function plannedFor(item: Item, occurrence: string): Planned[] {
  const out: Planned[] = [];
  const before = Math.min(fromDays(item, occurrence), 400);
  for (let k = before; k >= 1; k--) {
    out.push({
      at: atTime(addDays(occurrence, -k), item.time),
      kind: 'window',
      phase: 'before',
      occurrence,
      last: false,
    });
  }
  for (const off of preOffsets(item)) {
    out.push({ at: atTime(occurrence, item.time - off), kind: 'pre', phase: 'event', occurrence, last: false });
  }
  out.push({ at: atTime(occurrence, item.time), kind: 'main', phase: 'event', occurrence, last: false });
  const after = Math.min(diffDays(occurrence, untilDay(item, occurrence)), 400);
  for (let k = 1; k <= after; k++) {
    out.push({
      at: atTime(addDays(occurrence, k), item.time),
      kind: 'window',
      phase: 'after',
      occurrence,
      last: k === after,
    });
  }
  return out;
}

export function ringsLikeAlarm(item: Pick<Item, 'kind' | 'ringLikeAlarm'>): boolean {
  return item.kind === 'alarm' || item.ringLikeAlarm;
}

/**
 * The tasks as they stand for one occurrence. Repeating items start every occurrence fresh:
 * ticks saved for an older occurrence count as not done.
 */
export function tasksOf(item: Pick<Item, 'lines' | 'repeat' | 'tasksFor'>, occurrence?: string | null): Line[] {
  const fresh = item.repeat !== 'once' && !!occurrence && item.tasksFor !== occurrence;
  return item.lines
    .filter((l) => l.type === 'task' && l.text.trim().length > 0)
    .map((l) => (fresh ? { ...l, done: false } : l));
}

export function taskCount(
  item: Pick<Item, 'lines' | 'repeat' | 'tasksFor'>,
  occurrence?: string | null,
): { done: number; total: number } {
  const tasks = tasksOf(item, occurrence);
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

export function titleOf(item: Pick<Item, 'name' | 'kind'>): string {
  return item.name.trim() || (item.kind === 'alarm' ? 'Alarm' : 'Reminder');
}

function bodyFor(item: Item, p: Planned, now: Date): string {
  const time = fmtTime(item.time);
  const due = item.kind === 'alarm' ? 'Alarm' : 'Due';
  if (p.kind === 'pre') {
    const main = atTime(p.occurrence, item.time);
    return `${due} at ${time} · in ${fmtLeft(main.getTime() - p.at.getTime())}`;
  }
  if (p.kind === 'main') {
    const t = taskCount(item);
    return t.total ? `${time} · ${t.total} ${t.total === 1 ? 'task' : 'tasks'}` : time;
  }
  if (p.phase === 'before') {
    const days = diffDays(wallClock(p.at).slice(0, 10), p.occurrence);
    return `${due === 'Alarm' ? 'Event' : 'Due'} ${fmtDate(p.occurrence, now)} · in ${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `Was due ${fmtDate(p.occurrence, now)}${p.last ? ' · Last reminder' : ''}`;
}

/** "Due Tue 15 Dec · 9:00 AM" style line for reminder notifications. */
function dueFor(item: Item, p: Planned, now: Date): string {
  const time = fmtTime(item.time);
  if (p.phase === 'before') {
    const days = diffDays(wallClock(p.at).slice(0, 10), p.occurrence);
    return `Due ${fmtDate(p.occurrence, now)} · ${time} · in ${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (p.phase === 'after') return `Was due ${fmtDate(p.occurrence, now)} · ${time}${p.last ? ' · Last reminder' : ''}`;
  if (p.kind === 'pre') {
    const main = atTime(p.occurrence, item.time);
    return `Due at ${time} · in ${fmtLeft(main.getTime() - p.at.getTime())}`;
  }
  return `Due now · ${time}`;
}

const PRIORITY: Record<Planned['kind'], number> = { main: 3, window: 2, pre: 1 };

function toNative(item: Item, p: Planned, now: Date): NativeTrigger {
  const rings = ringsLikeAlarm(item);
  const style: NativeTrigger['style'] = !rings ? 'notify' : p.kind === 'pre' ? 'pre' : 'ring';
  const wall = wallClock(p.at);
  return {
    id: `${item.id}:${wall}:${p.kind}`,
    alarmId: item.id,
    kind: p.kind,
    style,
    wall,
    at: p.at.getTime(),
    title: titleOf(item),
    body: bodyFor(item, p, now),
    sound: p.kind === 'pre' ? item.sound.pre : item.sound.main,
    rising: item.sound.rising,
    vibrate: item.sound.vibrate,
    ringMinutes: p.kind === 'pre' ? 1 : 10,
    snoozeMinutes: item.snooze.minutes,
    snoozeLimit: item.snooze.times,
    occurrence: p.occurrence,
    last: p.last,
    itemKind: item.kind,
    tasks: tasksOf(item, p.occurrence).map((l) => ({ id: l.id, text: l.text, done: l.done, level: l.level })),
    due: dueFor(item, p, now),
    overdue: p.phase === 'after',
    canDone: tracksDone(item),
  };
}

/** Upcoming rings of one item within [now, horizonEnd]; at least the next occurrence is always included. */
export function itemTriggers(item: Item, now: Date, horizonDays = HORIZON_DAYS): Planned[] {
  if (!item.enabled) return [];
  const today = todayYmd(now);
  const horizonEnd = atTime(addDays(today, horizonDays), 24 * 60);
  const first = addDays(today, -maxAfterSpan(item) - 1);
  const last = addDays(today, horizonDays + maxBeforeSpan(item) + 2);
  const nowMs = now.getTime();
  const out: Planned[] = [];
  for (const occ of occurrencesBetween(item, first, last)) {
    if (item.done.includes(occ)) continue;
    for (const p of plannedFor(item, occ)) {
      const t = p.at.getTime();
      if (t > nowMs && t <= horizonEnd.getTime()) out.push(p);
    }
  }
  if (out.length === 0) {
    // Far-away occurrence (e.g. yearly): still arm it so nothing depends on opening the app.
    let from = addDays(today, horizonDays + 1);
    for (let guard = 0; guard < 24; guard++) {
      const occ = nextOccurrence(item, from);
      if (!occ) break;
      if (!item.done.includes(occ)) {
        const future = plannedFor(item, occ).filter((p) => p.at.getTime() > nowMs);
        if (future.length) {
          out.push(...future);
          break;
        }
      }
      from = addDays(occ, 1);
    }
  }
  // Keep one ring per minute per item: the alarm beats a reminder day, which beats a pre-alarm.
  const byMinute = new Map<number, Planned>();
  for (const p of out) {
    const key = p.at.getTime();
    const prev = byMinute.get(key);
    if (!prev || PRIORITY[p.kind] > PRIORITY[prev.kind]) byMinute.set(key, p);
  }
  return [...byMinute.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function buildTriggers(items: Item[], now: Date = new Date()): NativeTrigger[] {
  const all: NativeTrigger[] = [];
  for (const item of items) {
    for (const p of itemTriggers(item, now)) all.push(toNative(item, p, now));
  }
  all.sort((a, b) => a.at - b.at);
  return all.slice(0, MAX_TRIGGERS);
}

export type NextRing = Planned;

/** The next time this item really rings (pre-alarms excluded). */
export function nextRing(item: Item, now: Date = new Date()): NextRing | null {
  if (!item.enabled) return null;
  const nowMs = now.getTime();
  let from = addDays(todayYmd(now), -maxAfterSpan(item) - 1);
  for (let guard = 0; guard < 400; guard++) {
    const occ = nextOccurrence(item, from);
    if (!occ) return null;
    if (!item.done.includes(occ)) {
      const next = plannedFor(item, occ).find((p) => p.kind !== 'pre' && p.at.getTime() > nowMs);
      if (next) return next;
    }
    from = addDays(occ, 1);
  }
  return null;
}

/** Items whose done-ness matters: reminders, and alarms that keep reminding after the event. */
export function tracksDone(item: Pick<Item, 'kind' | 'until'>): boolean {
  return item.kind === 'reminder' || item.until.kind !== 'event';
}

/** The most recent occurrence whose time has passed without being ticked done, if any. */
export function overdueOccurrence(item: Item, now: Date = new Date()): string | null {
  if (!tracksDone(item)) return null;
  const today = todayYmd(now);
  const occ = previousOccurrence(item, today);
  if (!occ) return null;
  if (atTime(occ, item.time).getTime() > now.getTime()) {
    // Today's occurrence hasn't happened yet; look at the one before.
    const prev = previousOccurrence(item, addDays(occ, -1));
    if (!prev || item.done.includes(prev)) return null;
    return prev;
  }
  return item.done.includes(occ) ? null : occ;
}

/** The occurrence the user is dealing with now (for ticking done): overdue first, else the next one. */
export function currentOccurrence(item: Item, now: Date = new Date()): string | null {
  return overdueOccurrence(item, now) ?? nextRing(item, now)?.occurrence ?? null;
}

export type Group = 'notdone' | 'today' | 'tomorrow' | 'later' | 'off';

export type ListEntry = {
  item: Item;
  group: Group;
  next: NextRing | null;
  overdue: string | null;
};

export function listEntries(items: Item[], now: Date = new Date()): ListEntry[] {
  const today = todayYmd(now);
  const tomorrow = addDays(today, 1);
  const entries = items.map((item): ListEntry => {
    const next = nextRing(item, now);
    const overdue = item.enabled ? overdueOccurrence(item, now) : null;
    let group: Group;
    if (overdue && (!next || next.occurrence === overdue)) group = 'notdone';
    else if (!next) group = 'off';
    else {
      const day = wallClock(next.at).slice(0, 10);
      group = day === today ? 'today' : day === tomorrow ? 'tomorrow' : 'later';
    }
    return { item, group, next, overdue };
  });
  const order: Group[] = ['notdone', 'today', 'tomorrow', 'later', 'off'];
  return entries.sort((a, b) => {
    const g = order.indexOf(a.group) - order.indexOf(b.group);
    if (g !== 0) return g;
    const ta = a.next ? a.next.at.getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.next ? b.next.at.getTime() : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.item.time - b.item.time;
  });
}

/**
 * The day it actually rings next. One-time: the chosen day, or tomorrow if that time has already
 * passed today. Repeating: the next matching day.
 */
export function effectiveDay(item: Item, now: Date = new Date()): string {
  const today = todayYmd(now);
  if (item.repeat === 'once') {
    let d = item.date < today ? today : item.date;
    if (atTime(d, item.time).getTime() <= now.getTime()) d = addDays(d, 1);
    return d;
  }
  let d = nextOccurrence(item, today);
  if (d && atTime(d, item.time).getTime() <= now.getTime()) d = nextOccurrence(item, addDays(d, 1));
  return d ?? item.date;
}

/** When an item is switched back on (or saved) with a past one-time date, move it to the next time that fits. */
export function rollForwardIfPast(item: Item, now: Date = new Date()): Item {
  if (item.repeat !== 'once') return item;
  if (atTime(item.date, item.time).getTime() > now.getTime()) return item;
  const today = todayYmd(now);
  const day = atTime(today, item.time).getTime() > now.getTime() ? today : addDays(today, 1);
  return { ...item, date: day, done: [] };
}
