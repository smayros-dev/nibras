import { describe, expect, it } from 'vitest';
import { InMemoryEmailProvider } from './in-memory';
import { renderEmail } from './templates';
import { EMAIL_TEMPLATE_KEYS, type EmailParamsByKey, type EmailTemplateKey } from './types';

// Compile-time contract (checked by `tsc --noEmit`): each template key has exactly one params
// type, and `EMAIL_TEMPLATE_KEYS` lists exactly the keys of `EmailParamsByKey`.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _keysMatch: Same<EmailTemplateKey, keyof EmailParamsByKey> = true;

describe('typed email params', () => {
  it('rejects wrong or missing params at compile time and at runtime', async () => {
    const email = new InMemoryEmailProvider();
    const base = { to: 'a@example.com', locale: 'fr' } as const;

    await expect(
      email.send({
        ...base,
        templateKey: 'auth.verify_email',
        // @ts-expect-error `link` is missing
        params: { firstName: 'A' },
      }),
    ).rejects.toThrow();
    await expect(
      email.send({
        ...base,
        templateKey: 'security.account_locked',
        // @ts-expect-error `minutes` is a number
        params: { firstName: 'A', minutes: 'fifteen' },
      }),
    ).resolves.toBeDefined();
    await expect(
      email.send({
        ...base,
        templateKey: 'phone.otp_dev',
        // @ts-expect-error one-time codes are named `otpCode`, never `code`
        params: { code: '123456' },
      }),
    ).rejects.toThrow();
    // @ts-expect-error unknown template key
    expect(() => renderEmail('auth.nope', 'fr', {})).toThrow();

    // Correct params compile and render.
    await email.send({
      ...base,
      templateKey: 'security.account_locked',
      params: { firstName: 'A', minutes: 15 },
    });
    expect(email.findByTemplate('security.account_locked')).toHaveLength(2);
    expect(EMAIL_TEMPLATE_KEYS).toHaveLength(34);
    expect(_keysMatch).toBe(true);
  });
});
