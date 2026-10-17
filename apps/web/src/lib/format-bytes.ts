/** A decimal byte count (bigint-safe string from the API) as `1.5 GB`; non-numbers pass through. */
export function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(n < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}
