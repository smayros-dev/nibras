import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('lowercases, strips diacritics and joins words with dashes', () => {
    expect(slugify('Espace de Mohamed')).toBe('espace-de-mohamed');
    expect(slugify('Académie Nour')).toBe('academie-nour');
    expect(slugify('  Élève -- Ça  va ?! ')).toBe('eleve-ca-va');
  });

  it('drops characters outside a-z0-9 (e.g. Arabic) and trims dashes', () => {
    expect(slugify('Espace de محمد')).toBe('espace-de');
    expect(slugify('محمد')).toBe('');
    expect(slugify('---a---')).toBe('a');
  });

  it('caps at 48 characters without a trailing dash', () => {
    const s = slugify(`${'a'.repeat(47)} bcd`);
    expect(s).toBe('a'.repeat(47));
    expect(slugify('x'.repeat(100))).toHaveLength(48);
  });
});

describe('uniqueSlug', () => {
  it('appends 6 lowercase base32 characters', () => {
    expect(uniqueSlug('espace-de-mohamed')).toMatch(/^espace-de-mohamed-[a-z2-7]{6}$/);
    expect(uniqueSlug('espace-de-mohamed')).not.toBe(uniqueSlug('espace-de-mohamed'));
  });

  it('falls back to "espace" for an empty base', () => {
    expect(uniqueSlug('')).toMatch(/^espace-[a-z2-7]{6}$/);
  });
});
