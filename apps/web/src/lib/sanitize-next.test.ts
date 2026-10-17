import { describe, expect, it } from 'vitest';
import { sanitizeNext } from './sanitize-next';

describe('sanitizeNext', () => {
  it.each([
    ['/app', '/app'],
    ['/app/w/x?tab=1', '/app/w/x?tab=1'],
    ['/fr/app', '/app'],
    ['/ar/app/settings/profile?x=1', '/app/settings/profile?x=1'],
    ['/en', '/'],
    ['/french/app', '/french/app'],
    ['/app/../app/settings', '/app/settings'],
    ['/x/../fr/app', '/app'],
  ])('accepts %s as %s', (input, expected) => {
    expect(sanitizeNext(input)).toBe(expected);
  });

  it.each([
    ['//evil'],
    ['/\\evil'],
    ['\\\\evil'],
    ['/app\\..\\evil'],
    ['https://x'],
    ['javascript:alert(1)'],
    ['app'],
    ['/app\r\nSet-Cookie: x=1'],
    ['/\t/evil'],
    ['/\n/evil'],
    ['/fr//evil'],
    ['/fr/\\evil'],
    ['/fr/app\\x'],
    ['/..//evil'],
    ['/fr/..//evil'],
    ['/./..//evil'],
    ['/app/../..//evil'],
    ['/%2e%2e//evil'],
    ['/fr/%2E%2E//evil'],
    [''],
  ])('rejects %j', (input) => {
    expect(sanitizeNext(input)).toBeNull();
  });

  it('maps null and undefined to null', () => {
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
  });
});
