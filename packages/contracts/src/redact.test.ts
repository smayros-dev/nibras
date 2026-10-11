import { describe, expect, it } from 'vitest';
import { REDACT_KEYS, REDACT_SCOPED_PATHS, redactPaths } from './redact';

describe('redactPaths', () => {
  it('uses bracket notation for hyphenated keys and honours depth', () => {
    expect(redactPaths(1)).toHaveLength(REDACT_KEYS.length * 2 + REDACT_SCOPED_PATHS.length);
    expect(redactPaths(2)).toEqual(
      expect.arrayContaining(['otp', '*.otp', '*.*.otp', '["set-cookie"]', '*.*["set-cookie"]']),
    );
    expect(redactPaths().filter((p) => p.includes('-') && !p.includes('["'))).toEqual([]);
  });

  it('redacts otp/verification/recovery codes and scoped body/data.code, never bare code', () => {
    const paths = redactPaths();
    expect(paths).toEqual(
      expect.arrayContaining([
        'otpCode',
        '*.otpCode',
        'verificationCode',
        'recoveryCode',
        'body.code',
        '*.body.code',
        'data.code',
        '*.data.code',
      ]),
    );
    expect(paths).not.toContain('code');
    expect(paths).not.toContain('*.code');
    expect(REDACT_KEYS).not.toContain('code');
  });
});
