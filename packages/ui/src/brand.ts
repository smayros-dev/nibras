/**
 * Brand constants for places CSS cannot reach (web manifest, `<meta name="theme-color">`,
 * emails later). The brand is a placeholder until the owner names the product (PRD §20 Q1):
 * rebranding = editing this object and the brand block of `tokens.css`.
 * `themeColor` = `--color-primary` (light), `backgroundColor` = `--color-bg` (light),
 * `darkThemeColor` = `--color-bg` (dark).
 */
export const BRAND = {
  name: 'Plateforme cours',
  shortName: 'Cours',
  themeColor: '#0f766e',
  backgroundColor: '#faf9f7',
  darkThemeColor: '#0c1116',
} as const;
