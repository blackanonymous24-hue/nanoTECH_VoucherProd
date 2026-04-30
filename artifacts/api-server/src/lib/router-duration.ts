/**
 * Parse MikroTik-style duration strings (e.g. "30d", "1w2d", "4h30m", "1w2d3h4m5s") to milliseconds.
 */
export function parseRouterDurationToMs(s: string | null | undefined): number | null {
  if (!s || !String(s).trim()) return null;
  const str = String(s).trim().toLowerCase();
  if (str === "0" || /^0+s?$/.test(str)) return 0;
  let total = 0;
  const re = /(\d+)\s*(w|d|h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const n = parseInt(m[1], 10);
    const u = m[2];
    total += u === "w" ? n * 7 * 24 * 3600 * 1000
      : u === "d" ? n * 24 * 3600 * 1000
        : u === "h" ? n * 3600 * 1000
          : u === "m" ? n * 60 * 1000
            : n * 1000;
  }
  return total > 0 ? total : null;
}
