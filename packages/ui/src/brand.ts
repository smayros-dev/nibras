/**
 * Brand constants for places CSS cannot reach (web manifest, `<meta name="theme-color">`,
 * emails later). The product is named Nibras (نبراس, owner decision 2026-10-17, PRD §20 Q1):
 * rebranding = editing this object and the brand block of `tokens.css`.
 * `themeColor` = `--color-primary` (light), `backgroundColor` = `--color-bg` (light),
 * `darkThemeColor` = `--color-bg` (dark).
 */
export const BRAND = {
  name: 'Nibras',
  shortName: 'Nibras',
  themeColor: '#0f766e',
  backgroundColor: '#faf9f7',
  darkThemeColor: '#0c1116',
} as const;
