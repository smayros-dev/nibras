import { LogSmsProvider, SmtpEmailProvider } from '@nibras/providers';
import { describe, expect, it, vi } from 'vitest';
import { FakePwnedClient, HibpClient } from '../auth/crypto/hibp';
import { SecretBox } from '../auth/crypto/secret-box';
import {
  createEmailProvider,
  createPwnedClient,
  createSecretBox,
  createSmsProvider,
} from './providers.module';

const KEY = Buffer.from('test-only-totp-key-32-bytes-long').toString('base64');

describe('provider factories', () => {
  it('uses the HIBP client only when HIBP_ENABLED', async () => {
    expect(createPwnedClient({ HIBP_ENABLED: true })).toBeInstanceOf(HibpClient);
    const off = createPwnedClient({ HIBP_ENABLED: false });
    expect(off).toBeInstanceOf(FakePwnedClient);
    // Disabled = nothing is ever reported breached (no network call).
    await expect(off.isPwned('password1234')).resolves.toBe(false);
  });

  it('builds the SecretBox from TOTP_ENCRYPTION_KEY', () => {
    const box = createSecretBox({ TOTP_ENCRYPTION_KEY: KEY });
    expect(box).toBeInstanceOf(SecretBox);
    // Same key: a box built directly from it opens what the provider sealed.
    expect(new SecretBox(KEY).open(box.seal('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
  });

  it('maps SMS_PROVIDER=console to the log provider', () => {
    const logger = { info: vi.fn(), debug: vi.fn() };
    expect(createSmsProvider({ SMS_PROVIDER: 'console' }, logger)).toBeInstanceOf(LogSmsProvider);
  });

  it('sends email over SMTP from SMTP_URL / EMAIL_FROM', () => {
    expect(
      createEmailProvider({ SMTP_URL: 'smtp://localhost:1025', EMAIL_FROM: 'Nibras <a@b.c>' }),
    ).toBeInstanceOf(SmtpEmailProvider);
  });
});
