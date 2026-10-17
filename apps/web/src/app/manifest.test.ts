import { BRAND } from '@tt/ui';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('web app manifest', () => {
  const m = manifest();

  it('names the product from BRAND and uses its colours', () => {
    expect(m.name).toBe(BRAND.name);
    expect(m.short_name).toBe(BRAND.shortName);
    expect(m.theme_color).toBe(BRAND.themeColor);
    expect(m.background_color).toBe(BRAND.backgroundColor);
  });

  it('is an installable standalone app rooted at / (the proxy negotiates the locale)', () => {
    expect(m).toMatchObject({
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      lang: 'fr',
      dir: 'auto',
      categories: ['education'],
    });
  });

  it('lists 192/512 "any" icons and a maskable 512 that all exist in public/', () => {
    expect(m.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
      ]),
    );
    for (const icon of m.icons ?? []) {
      expect(existsSync(fileURLToPath(new URL(`../../public${icon.src}`, import.meta.url)))).toBe(
        true,
      );
    }
  });
});
