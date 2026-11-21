// Links from Android notifications: celestial://ring opens the ring screen,
// celestial://item?id=… opens that reminder with its tasks.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/(^|\/)ring(\?|$|\/)/.test(path)) return '/ring';
    const item = /item\?id=([^&#]+)/.exec(path);
    if (item) return `/ring?view=${item[1]}`;
    return path;
  } catch {
    return '/';
  }
}
