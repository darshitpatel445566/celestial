// Run: npx tsx tests/schedule.test.ts
import assert from 'node:assert/strict';

import { atTime, wallClock } from '../src/lib/dates';
import { newItem } from '../src/lib/defaults';
import { customSummary, fmtLeft, fmtRange, fmtTime, partOfDay, repeatLabel } from '../src/lib/format';
import { isOccurrence, nextOccurrence, occurrencesBetween } from '../src/lib/repeat';
import {
  buildTriggers,
  effectiveDay,
  itemTriggers,
  listEntries,
  nextRing,
  overdueOccurrence,
  preOffsets,
  rollForwardIfPast,
  tasksOf,
  untilDay,
} from '../src/lib/schedule';
import { taskEntries } from '../src/lib/tasks';
import type { Item, Line } from '../src/lib/types';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL', name);
    throw e;
  }
}

const NOW = new Date(2026, 10, 21, 16, 29, 20); // Sat 21 Nov 2026, 4:29:20 PM

function item(over: Partial<Item>): Item {
  return { ...newItem('alarm', NOW), ...over };
}

const walls = (it: Item, now = NOW) => itemTriggers(it, now).map((p) => `${wallClock(p.at)} ${p.kind}`);

test('format basics', () => {
  assert.equal(fmtTime(0), '12:00 AM');
  assert.equal(fmtTime(540), '9:00 AM');
  assert.equal(fmtTime(989), '4:29 PM');
  assert.equal(fmtTime(-15), '11:45 PM');
  assert.equal(partOfDay(540), 'morning');
  assert.equal(partOfDay(989), 'afternoon');
  assert.equal(partOfDay(18 * 60), 'evening');
  assert.equal(partOfDay(23 * 60), 'night');
  assert.equal(partOfDay(4 * 60 + 59), 'night');
  assert.equal(fmtLeft(8 * 3600e3 + 10 * 60e3), '8 h 10 min');
  assert.equal(fmtLeft(45 * 60e3), '45 min');
  assert.equal(fmtRange('2026-12-08', '2026-12-22'), '8 – 22 Dec');
  assert.equal(fmtRange('2026-11-28', '2026-12-05'), '28 Nov – 5 Dec');
});

test('new item starts at the next whole minute', () => {
  const it = newItem('alarm', NOW);
  assert.equal(it.date, '2026-11-21');
  assert.equal(it.time, 16 * 60 + 30);
});

test('pre-alarms count back from the alarm in gap steps, plus pins', () => {
  assert.deepEqual(preOffsets({ lead: 60, gap: 15, pins: [] }), [60, 45, 30, 15]);
  assert.deepEqual(preOffsets({ lead: 50, gap: 15, pins: [] }), [45, 30, 15]);
  assert.deepEqual(preOffsets({ lead: 30, gap: 15, pins: [150, 30] }), [150, 30, 15]);
  assert.deepEqual(preOffsets({ lead: 0, gap: 15, pins: [] }), []);
});

test('one-time alarm with 4 pre-alarms', () => {
  const it = item({ date: '2026-12-15', time: 540, lead: 60, gap: 15 });
  assert.deepEqual(walls(it), [
    '2026-12-15 08:00 pre',
    '2026-12-15 08:15 pre',
    '2026-12-15 08:30 pre',
    '2026-12-15 08:45 pre',
    '2026-12-15 09:00 main',
  ]);
});

test('pre-alarms can cross midnight', () => {
  const it = item({ date: '2026-11-23', time: 15, lead: 30, gap: 15 });
  assert.deepEqual(walls(it), ['2026-11-22 23:45 pre', '2026-11-23 00:00 pre', '2026-11-23 00:15 main']);
});

test('remind every day: 1 week before until 1 week after (8 Nov … 22 Nov example)', () => {
  const now = new Date(2026, 10, 1, 8, 0);
  const it = item({
    kind: 'reminder',
    date: '2026-11-15',
    time: 540,
    from: { kind: 'before', n: 1, unit: 'week' },
    until: { kind: 'after', n: 1, unit: 'week' },
  });
  const ps = itemTriggers(it, now);
  assert.equal(ps.length, 15);
  assert.equal(wallClock(ps[0].at), '2026-11-08 09:00');
  assert.equal(wallClock(ps[7].at), '2026-11-15 09:00');
  assert.equal(ps[7].kind, 'main');
  assert.equal(wallClock(ps[14].at), '2026-11-22 09:00');
  assert.equal(ps[14].last, true);
  assert.equal(ps.filter((p) => p.last).length, 1);
  const native = buildTriggers([it], now);
  assert.ok(native.every((t) => t.style === 'notify'));
  assert.match(native[0].body, /Due Sun 15 Nov · in 7 days/);
  assert.match(native[14].body, /Was due Sun 15 Nov · Last reminder/);
});

test('until "on date" may be after the event (8 Nov reminder, start 1 Nov, end 15 Nov)', () => {
  const now = new Date(2026, 9, 30, 8, 0);
  const it = item({
    kind: 'reminder',
    date: '2026-11-08',
    time: 600,
    from: { kind: 'before', n: 7, unit: 'day' },
    until: { kind: 'date', date: '2026-11-15' },
  });
  const ps = itemTriggers(it, now);
  assert.equal(wallClock(ps[0].at), '2026-11-01 10:00');
  assert.equal(wallClock(ps[ps.length - 1].at), '2026-11-15 10:00');
  assert.equal(ps.length, 15);
});

test('done occurrence stops its reminders', () => {
  const now = new Date(2026, 10, 16, 8, 0);
  const it = item({
    kind: 'reminder',
    date: '2026-11-15',
    time: 540,
    until: { kind: 'after', n: 1, unit: 'week' },
  });
  assert.equal(itemTriggers(it, now).length, 7);
  assert.equal(overdueOccurrence(it, now), '2026-11-15');
  const done = { ...it, done: ['2026-11-15'] };
  assert.equal(itemTriggers(done, now).length, 0);
  assert.equal(overdueOccurrence(done, now), null);
});

test('monthly GST on the 20th: 3 days before until 2 days after, every month', () => {
  const now = new Date(2026, 10, 21, 12, 0);
  const it = item({
    date: '2026-11-20',
    time: 600,
    repeat: 'monthly',
    from: { kind: 'before', n: 3, unit: 'day' },
    until: { kind: 'after', n: 2, unit: 'day' },
    done: ['2026-11-20'],
  });
  const ws = walls(it, now);
  assert.deepEqual(ws.slice(0, 6), [
    '2026-12-17 10:00 window',
    '2026-12-18 10:00 window',
    '2026-12-19 10:00 window',
    '2026-12-20 10:00 main',
    '2026-12-21 10:00 window',
    '2026-12-22 10:00 window',
  ]);
});

test('monthly on the 31st uses the last day of short months', () => {
  const it = item({ date: '2026-01-31', repeat: 'monthly' });
  assert.deepEqual(occurrencesBetween(it, '2026-01-01', '2026-05-31'), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
  ]);
});

test('weekdays, weekends, fortnightly, yearly', () => {
  const wk = item({ date: '2026-11-21', repeat: 'weekdays' }); // Saturday
  assert.equal(nextOccurrence(wk, '2026-11-21'), '2026-11-23');
  const we = item({ date: '2026-11-23', repeat: 'weekends' });
  assert.deepEqual(occurrencesBetween(we, '2026-11-23', '2026-11-30'), ['2026-11-28', '2026-11-29']);
  const fn = item({ date: '2026-11-24', repeat: 'fortnightly' });
  assert.deepEqual(occurrencesBetween(fn, '2026-11-01', '2026-12-31'), ['2026-11-24', '2026-12-08', '2026-12-22']);
  const yr = item({ date: '2028-02-29', repeat: 'yearly' });
  assert.equal(isOccurrence(yr, '2029-02-28'), true);
});

test('custom: every 2 weeks on Tuesday', () => {
  const it = item({
    date: '2026-11-24',
    repeat: 'custom',
    custom: { freq: 'weekly', every: 2, weekdays: [2], monthDays: [], months: [] },
  });
  assert.deepEqual(occurrencesBetween(it, '2026-11-20', '2026-12-31'), ['2026-11-24', '2026-12-08', '2026-12-22']);
  assert.equal(customSummary(it.custom, it.date), 'Rings every 2 weeks on Tuesday');
  assert.equal(repeatLabel(it), 'Every 2 weeks on Tuesday');
});

test('custom: monthly on the 5th and 20th, yearly in March', () => {
  const m = item({
    date: '2026-11-01',
    repeat: 'custom',
    custom: { freq: 'monthly', every: 1, weekdays: [], monthDays: [20, 5], months: [] },
  });
  assert.deepEqual(occurrencesBetween(m, '2026-11-01', '2026-12-31'), [
    '2026-11-05',
    '2026-11-20',
    '2026-12-05',
    '2026-12-20',
  ]);
  assert.equal(customSummary(m.custom, m.date), 'Rings every month on the 5th and 20th');
  const y = item({
    date: '2026-03-10',
    repeat: 'custom',
    custom: { freq: 'yearly', every: 1, weekdays: [], monthDays: [], months: [2] },
  });
  assert.equal(nextOccurrence(y, '2026-11-21'), '2027-03-10');
});

test('end repeat is inclusive', () => {
  const it = item({ date: '2026-11-22', repeat: 'daily', endRepeat: '2026-11-24' });
  assert.deepEqual(occurrencesBetween(it, '2026-11-01', '2026-12-31'), ['2026-11-22', '2026-11-23', '2026-11-24']);
});

test('far-away yearly item is still armed', () => {
  const it = item({ date: '2027-06-01', time: 480, repeat: 'yearly' });
  const ps = itemTriggers(it, NOW);
  assert.equal(ps.length, 1);
  assert.equal(wallClock(ps[0].at), '2027-06-01 08:00');
});

test('styles: alarm rings, reminder notifies, ring-like-alarm reminder rings', () => {
  const base = { date: '2026-11-22', time: 540, lead: 30, gap: 15 };
  const a = buildTriggers([item({ ...base })], NOW).map((t) => t.style);
  assert.deepEqual(a, ['pre', 'pre', 'ring']);
  const r = buildTriggers([item({ ...base, kind: 'reminder' })], NOW).map((t) => t.style);
  assert.deepEqual(r, ['notify', 'notify', 'notify']);
  const rl = buildTriggers([item({ ...base, kind: 'reminder', ringLikeAlarm: true })], NOW).map((t) => t.style);
  assert.deepEqual(rl, ['pre', 'pre', 'ring']);
  const t = buildTriggers([item({ ...base })], NOW)[2];
  assert.equal(t.wall, '2026-11-22 09:00');
  assert.equal(t.snoozeLimit, 3);
  assert.equal(t.sound, 'raw:classic');
  const pre = buildTriggers([item({ ...base })], NOW)[0];
  assert.equal(pre.sound, 'raw:chime');
  assert.match(pre.body, /Alarm at 9:00 AM · in 30 min/);
});

test('past triggers are skipped, disabled items produce nothing', () => {
  // 4:29 PM now: the 4:10 and 4:25 pre-alarms are past, only the 4:40 alarm remains.
  const it = item({ date: '2026-11-21', time: 16 * 60 + 40, lead: 30, gap: 15 });
  assert.deepEqual(walls(it), ['2026-11-21 16:40 main']);
  assert.equal(itemTriggers({ ...it, enabled: false }, NOW).length, 0);
});

test('next ring and list groups', () => {
  const todayAlarm = item({ id: 'a', date: '2026-11-21', time: 20 * 60 });
  const tomorrow = item({ id: 'b', date: '2026-11-22', time: 7 * 60 });
  const later = item({ id: 'c', date: '2026-12-15', time: 540 });
  const off = item({ id: 'd', date: '2026-11-21', time: 8 * 60 }); // passed today, one-time
  const notDone = item({ id: 'e', kind: 'reminder', date: '2026-11-20', time: 600 });
  const disabled = item({ id: 'f', enabled: false });
  const entries = listEntries([later, off, tomorrow, todayAlarm, notDone, disabled], NOW);
  assert.deepEqual(
    entries.map((e) => `${e.item.id}:${e.group}`),
    ['e:notdone', 'a:today', 'b:tomorrow', 'c:later', 'd:off', 'f:off'],
  );
  assert.equal(wallClock(nextRing(todayAlarm, NOW)!.at), '2026-11-21 20:00');
});

test('daily alarm set for a time already passed today rings tomorrow', () => {
  const it = item({ date: '2026-11-21', time: 7 * 60, repeat: 'daily' });
  assert.equal(wallClock(nextRing(it, NOW)!.at), '2026-11-22 07:00');
});

test('switching a past one-time alarm back on moves it forward', () => {
  const it = item({ date: '2026-11-20', time: 20 * 60 });
  assert.equal(rollForwardIfPast(it, NOW).date, '2026-11-21');
  const early = item({ date: '2026-11-20', time: 6 * 60 });
  assert.equal(rollForwardIfPast(early, NOW).date, '2026-11-22');
});

test('until day helper', () => {
  const it = item({ until: { kind: 'after', n: 1, unit: 'month' } });
  assert.equal(untilDay(it, '2026-01-31'), '2026-02-28');
  assert.equal(atTime('2026-11-21', 1440 + 30).getDate(), 22);
});

test('any time can be picked: a time already passed today rings tomorrow', () => {
  // 4:29 PM now
  assert.equal(effectiveDay(item({ date: '2026-11-21', time: 9 * 60 }), NOW), '2026-11-22');
  assert.equal(effectiveDay(item({ date: '2026-11-21', time: 18 * 60 }), NOW), '2026-11-21');
  // A date chosen in the calendar stays, whatever the time
  assert.equal(effectiveDay(item({ date: '2026-11-25', time: 9 * 60 }), NOW), '2026-11-25');
  // An old one-time date counts from today
  assert.equal(effectiveDay(item({ date: '2026-11-02', time: 18 * 60 }), NOW), '2026-11-21');
  // Repeating: the next matching day after now
  assert.equal(effectiveDay(item({ date: '2026-11-16', time: 9 * 60, repeat: 'weekdays' }), NOW), '2026-11-23');
});

const task = (id: string, text: string, done = false, level: 0 | 1 = 0): Line => ({
  id,
  text,
  type: 'task',
  level,
  done,
});

test('repeating items start each occurrence with fresh ticks', () => {
  const it = item({ repeat: 'daily', tasksFor: '2026-11-20', lines: [task('x', 'Pack', true)] });
  assert.equal(tasksOf(it, '2026-11-20')[0].done, true);
  assert.equal(tasksOf(it, '2026-11-21')[0].done, false);
  const once = item({ lines: [task('x', 'Pack', true)] });
  assert.equal(tasksOf(once, '2026-11-25')[0].done, true);
});

test('tasks page groups by day and puts ticked tasks last', () => {
  const late = item({
    id: 'r1',
    kind: 'reminder',
    date: '2026-11-20',
    time: 600,
    lines: [task('a', 'Pay rent'), task('b', 'Send receipt', false, 1)],
  });
  const today = item({ id: 'a1', date: '2026-11-21', time: 20 * 60, lines: [task('c', 'Water plants', true)] });
  const tomorrow = item({ id: 'a2', date: '2026-11-22', time: 7 * 60, lines: [task('d', 'Gym bag')] });
  const doneReminder = item({
    id: 'r2',
    kind: 'reminder',
    date: '2026-11-19',
    time: 600,
    done: ['2026-11-19'],
    lines: [task('e', 'Old thing')],
  });
  const entries = taskEntries([tomorrow, today, late, doneReminder], NOW);
  assert.deepEqual(
    entries.map((e) => `${e.group}:${e.line.text}`),
    ['overdue:Pay rent', 'overdue:Send receipt', 'tomorrow:Gym bag', 'done:Water plants'],
  );
});

console.log(`schedule tests: ${passed} passed`);
