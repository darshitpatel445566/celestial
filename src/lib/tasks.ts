import { addDays, atTime, today as todayYmd } from './dates';
import { currentOccurrence, tasksOf } from './schedule';
import type { Item, Line } from './types';

export type TaskGroup = 'overdue' | 'today' | 'tomorrow' | 'later' | 'done';

export type TaskEntry = {
  key: string;
  item: Item;
  /** The task as it stands for `occurrence` (repeating items start each occurrence fresh) */
  line: Line;
  /** The occurrence a tick applies to */
  occurrence: string | null;
  /** The day shown next to the task (null: switched off, no next day) */
  day: string | null;
  group: TaskGroup;
};

const ORDER: TaskGroup[] = ['overdue', 'today', 'tomorrow', 'later', 'done'];

/** The occurrence whose tasks matter now, or null when the item is off and has no fixed day. */
function occurrenceFor(item: Item, now: Date): string | null {
  const occ = item.enabled ? currentOccurrence(item, now) : null;
  if (occ) return occ;
  return item.repeat === 'once' ? item.date : null;
}

/**
 * Every task of every alarm and reminder, in one list: grouped by the day it belongs to,
 * ticked tasks last. Items already marked done for that day are left out.
 */
export function taskEntries(items: Item[], now: Date = new Date()): TaskEntry[] {
  const today = todayYmd(now);
  const tomorrow = addDays(today, 1);
  const out: (TaskEntry & { at: number; index: number })[] = [];
  for (const item of items) {
    const occurrence = occurrenceFor(item, now);
    if (occurrence && item.done.includes(occurrence)) continue;
    const tasks = tasksOf(item, occurrence);
    tasks.forEach((line, index) => {
      let group: TaskGroup;
      if (line.done) group = 'done';
      else if (!occurrence) group = 'later';
      else if (occurrence < today) group = 'overdue';
      else if (occurrence === today) group = 'today';
      else if (occurrence === tomorrow) group = 'tomorrow';
      else group = 'later';
      out.push({
        key: `${item.id}:${line.id}`,
        item,
        line,
        occurrence,
        day: occurrence,
        group,
        at: occurrence ? atTime(occurrence, item.time).getTime() : Number.MAX_SAFE_INTEGER,
        index,
      });
    });
  }
  out.sort((a, b) => {
    const g = ORDER.indexOf(a.group) - ORDER.indexOf(b.group);
    if (g !== 0) return g;
    if (a.at !== b.at) return a.at - b.at;
    if (a.item.id !== b.item.id) return a.item.id < b.item.id ? -1 : 1;
    return a.index - b.index;
  });
  return out.map((e) => ({
    key: e.key,
    item: e.item,
    line: e.line,
    occurrence: e.occurrence,
    day: e.day,
    group: e.group,
  }));
}
