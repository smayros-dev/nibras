import { describe, expect, it } from 'vitest';
import { negotiateLocale } from './negotiate';

describe('negotiateLocale (Accept-Language)', () => {
  it.each([
    // Review Focus 1: a regional subtag matches its language instead of falling through.
    ['ar-TN,fr;q=0.8', 'ar'],
    ['fr-FR,fr;q=0.9', 'fr'],
    ['en-US,en;q=0.9', 'en'],
    ['AR-tn', 'ar'],
    // The highest q wins, whatever the order in the header; ties keep header order.
    ['fr;q=0.5,ar;q=0.9', 'ar'],
    ['en,ar', 'en'],
    // Unsupported languages are skipped in favour of a later supported one.
    ['de-DE,en;q=0.5', 'en'],
    ['de-CH, ar-TN ;q=0.7, fr;q=0.6', 'ar'],
  ])('%s -> %s', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it.each([['de-DE'], ['*'], ['ar;q=0'], [''], [null]])(
    'returns undefined when nothing supported is acceptable (%s)',
    (header) => {
      expect(negotiateLocale(header)).toBeUndefined();
    },
  );
});
