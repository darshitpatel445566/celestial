// Date-only values are local "yyyy-mm-dd" strings; they compare correctly as strings.

export const pad = (n: number) => (n < 10 ? '0' + n : String(n));

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(now: Date = new Date()): string {
  return ymd(now);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** Adds months, keeping the day of month where possible (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s: string, n: number, day?: number): string {
  const d = parseYmd(s);
  const wanted = day ?? d.getDate();
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const dim = daysInMonth(first.getFullYear(), first.getMonth());
  return ymd(new Date(first.getFullYear(), first.getMonth(), Math.min(wanted, dim)));
}

export function weekday(s: string): number {
  return parseYmd(s).getDay();
}

/** Whole days from a to b (b − a). */
export function diffDays(a: string, b: string): number {
  const da = parseYmd(a);
  const db = parseYmd(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}

/** Local moment of a day plus minutes (minutes may be negative or above 1440). */
export function atTime(day: string, minutes: number): Date {
  const d = parseYmd(day);
  d.setHours(0, minutes, 0, 0);
  return d;
}

/** "yyyy-mm-dd HH:mm" local wall-clock time, as the native side expects. */
export function wallClock(d: Date): string {
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-based start of week, as "yyyy-mm-dd". */
export function weekStart(s: string): string {
  const wd = weekday(s);
  return addDays(s, -((wd + 6) % 7));
}
