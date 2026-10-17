import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WCAG AA guard for the semantic tokens (spec §3): every text pair ≥ 4.5:1, non-text
 * indicators (subtle text, strong borders, focus ring) ≥ 3:1, in both themes.
 */
const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

type Vars = Record<string, string>;

/** Body of the first block whose selector is exactly `selector` (blocks here never nest). */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match?.[1]) throw new Error(`block ${selector} not found in tokens.css`);
  return match[1];
}

function vars(body: string): Vars {
  const out: Vars = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const brandScale = vars(block('@theme'));
const light = vars(block(':root'));
// Any element (not only `:root`) can carry the dark theme, matching the `dark:` variant.
const dark = vars(block("[data-theme='dark']")); // prettier normalises to single quotes
const inline = vars(block('@theme inline'));

/** Resolves one level of `var(--x)` against the theme block, then the brand scale. */
function resolve(theme: Vars, name: string): string {
  const raw = theme[`tt-${name}`];
  if (!raw) throw new Error(`--tt-${name} missing`);
  const ref = /^var\(--([\w-]+)\)$/.exec(raw);
  if (!ref) return raw;
  const target = theme[ref[1]!] ?? brandScale[ref[1]!];
  if (!target) throw new Error(`unresolved ${raw}`);
  return target;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const channels = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['fg', 'surface-raised'],
  ['fg-muted', 'bg'],
  ['fg-muted', 'surface'],
  ['fg-muted', 'bg-subtle'],
  ['fg-muted', 'surface-raised'],
  ['primary-fg', 'primary'],
  ['primary-fg', 'primary-hover'],
  ['danger-fg', 'danger'],
  ['warning-fg', 'warning'],
  ['success-fg', 'success'],
  ['info-fg', 'info'],
  ['primary', 'surface'],
  ['primary', 'bg'],
  ['danger', 'surface'],
  ['fg', 'avatar-0'],
  ['fg', 'avatar-1'],
  ['fg', 'avatar-2'],
  ['fg', 'avatar-3'],
  ['fg', 'avatar-4'],
  ['fg', 'avatar-5'],
  ['fg', 'avatar-6'],
  ['fg', 'avatar-7'],
];
const NON_TEXT_PAIRS: [string, string][] = [
  ['fg-subtle', 'bg'],
  ['border-strong', 'surface'],
  ['focus', 'bg'],
  ['focus', 'surface'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast', (_name, theme) => {
  it.each(TEXT_PAIRS)('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(NON_TEXT_PAIRS)('%s on %s ≥ 3:1', (fg, bg) => {
    expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('token structure', () => {
  it('declares the same semantic names in light and dark', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('declares every semantic token listed in the spec', () => {
    const required = [
      'bg',
      'bg-subtle',
      'surface',
      'surface-raised',
      'fg',
      'fg-muted',
      'fg-subtle',
      'border',
      'border-strong',
      'primary',
      'primary-hover',
      'primary-fg',
      'primary-subtle',
      'danger',
      'danger-hover',
      'danger-fg',
      'danger-subtle',
      'warning',
      'warning-fg',
      'warning-subtle',
      'success',
      'success-fg',
      'success-subtle',
      'info',
      'info-fg',
      'info-subtle',
      'focus',
      'overlay',
    ].map((n) => `tt-${n}`);
    for (const name of required) expect(light, name).toHaveProperty([name]);
  });

  it('exposes every semantic token to Tailwind and nothing undefined', () => {
    const themed = Object.keys(light).map((raw) => raw.replace(/^tt-/, 'color-'));
    expect(Object.keys(inline).sort()).toEqual(themed.sort());
    for (const [name, value] of Object.entries(inline)) {
      expect(value).toBe(`var(--${name.replace(/^color-/, 'tt-')})`);
    }
  });

  it('keeps raw values under --tt-* so no Tailwind token references itself', () => {
    for (const name of Object.keys(light)) expect(name).toMatch(/^tt-/);
    for (const [name, value] of Object.entries(inline)) expect(value).not.toBe(`var(--${name})`);
  });
});

describe('motion inline sign', () => {
  it('is set for both directions so a nested ltr subtree resets an rtl ancestor', () => {
    expect(vars(block("[dir='ltr']"))['motion-inline-sign']).toBe('1');
    expect(vars(block("[dir='rtl']"))['motion-inline-sign']).toBe('-1');
  });
});
