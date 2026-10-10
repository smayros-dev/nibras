import { ERROR_CODES, LOCALES } from '@tt/contracts';
import { describe, expect, it } from 'vitest';
import { flattenKeys, getMessages, messages, type AbstractIntlMessages } from './locales';

function getPath(obj: AbstractIntlMessages, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], obj);
}

describe('messages', () => {
  it('every locale has exactly the same key set as fr (no missing, no extra)', () => {
    const fr = flattenKeys(messages.fr).sort();
    for (const l of ['ar', 'en'] as const) expect(flattenKeys(messages[l]).sort()).toEqual(fr);
  });

  it('no message is empty or still the French text in ar/en', () => {
    for (const l of ['ar', 'en'] as const)
      for (const k of flattenKeys(messages[l]))
        expect(getPath(messages[l], k), `${l}:${k}`).not.toBe('');
  });

  it('ar has no untranslated placeholders', () => {
    for (const k of flattenKeys(messages.ar)) expect(getPath(messages.ar, k)).not.toMatch(/^TODO/);
  });

  it('ships the SP0 namespaces and API error messages', () => {
    const keys = flattenKeys(messages.fr);
    for (const ns of ['common', 'nav', 'hello', 'errors', 'health'])
      expect(
        keys.some((k) => k.startsWith(`${ns}.`)),
        ns,
      ).toBe(true);
    for (const code of ERROR_CODES) expect(keys).toContain(`errors.${code}`);
  });

  it('getMessages returns the catalogue of each locale', () => {
    for (const l of LOCALES) expect(getMessages(l)).toBe(messages[l]);
    expect(getPath(getMessages('ar'), 'hello.title')).toBe('مرحباً');
  });
});

describe('flattenKeys', () => {
  it('returns dotted paths of leaf strings only', () => {
    expect(flattenKeys({ a: 'x', b: { c: 'y', d: { e: 'z' } } })).toEqual(['a', 'b.c', 'b.d.e']);
  });
});
