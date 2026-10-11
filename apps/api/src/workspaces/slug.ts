import { randomBytes } from 'node:crypto';

const SLUG_MAX = 48;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** Base of `uniqueSlug` when the name has no a-z0-9 character at all (e.g. only Arabic). */
const FALLBACK_BASE = 'espace';

/**
 * URL slug: NFKD, diacritics stripped, lower-cased, every run outside `a-z0-9` becomes one `-`,
 * leading/trailing `-` trimmed, at most 48 characters. May return `''`.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

/** `n` lowercase base32 characters (`[a-z2-7]`); 256 is a multiple of 32, so no modulo bias. */
function randomBase32(n: number): string {
  return Array.from(randomBytes(n), (b) => BASE32[b % 32]).join('');
}

/** `base-xxxxxx` (6 random base32 characters); `espace-xxxxxx` when `base` is empty. */
export function uniqueSlug(base: string): string {
  return `${base || FALLBACK_BASE}-${randomBase32(6)}`;
}
