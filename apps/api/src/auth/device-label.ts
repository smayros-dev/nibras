/**
 * Browser rules, most specific first: Edge, Opera and the iOS wrappers all also claim Chrome or
 * Safari in their user-agent.
 */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

/** OS rules, most specific first (Android and ChromeOS UAs also mention Linux). */
const SYSTEMS: [RegExp, string][] = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const match = (ua: string, rules: [RegExp, string][], fallback: string): string =>
  rules.find(([re]) => re.test(ua))?.[1] ?? fallback;

/**
 * Human label of a session's device, `Browser · OS` (e.g. `Firefox · Windows`): shown in the
 * device list and in the `security.new_device` email, and compared to decide whether a sign-in
 * comes from a new device. Coarse on purpose (no versions): an update must not look like a new
 * device.
 */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent.slice(0, 512);
  return `${match(ua, BROWSERS, 'Unknown browser')} · ${match(ua, SYSTEMS, 'Unknown OS')}`;
}
