import { describe, expect, it } from 'vitest';
import { REDACT_KEYS, redactPaths } from './redact';

describe('redactPaths', () => {
  it('uses bracket notation for hyphenated keys and honours depth', () => {
    expect(redactPaths(1)).toHaveLength(REDACT_KEYS.length * 2);
    expect(redactPaths(2)).toEqual(
      expect.arrayContaining(['code', '*.code', '*.*.code', '["set-cookie"]', '*.*["set-cookie"]']),
    );
    expect(redactPaths().filter((p) => p.includes('-') && !p.includes('["'))).toEqual([]);
  });
});
