import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SmtpEmailProvider, smtpTransportOptions } from './smtp';

// Load the monorepo root `.env` (already-set variables win) so `SMTP_URL` points at Mailpit.
const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const SMTP_URL = process.env.SMTP_URL;
const MAILPIT_API = 'http://localhost:8025/api/v1';

interface MailpitSearch {
  messages_count: number;
  messages: { ID: string; Subject: string }[];
}

async function search(to: string): Promise<MailpitSearch> {
  const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  expect(res.ok).toBe(true);
  return (await res.json()) as MailpitSearch;
}

describe.skipIf(!SMTP_URL)('SmtpEmailProvider (Mailpit)', () => {
  it('delivers a rendered email with html + text parts and an ICS invite', async () => {
    // Unique recipient: parallel worktrees share the one Mailpit.
    const to = `probe-${randomUUID()}@example.com`;
    const provider = new SmtpEmailProvider({
      smtpUrl: SMTP_URL!,
      from: 'Nibras (test) <no-reply@nibras.localhost>',
    });

    const { providerMessageId } = await provider.send({
      to,
      templateKey: 'auth.verify_email',
      locale: 'ar',
      params: { firstName: 'أحمد', link: 'https://x/ar/verify-email?token=abc' },
      ics: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//nibras//test//EN\r\nEND:VCALENDAR\r\n',
    });
    expect(providerMessageId).toMatch(/.+@.+/);

    const found = await search(to);
    expect(found.messages_count).toBe(1);
    expect(found.messages[0]!.Subject).toMatch(/[؀-ۿ]/);

    const res = await fetch(`${MAILPIT_API}/message/${found.messages[0]!.ID}`);
    const message = (await res.json()) as {
      HTML: string;
      Text: string;
      Attachments: { FileName: string }[];
    };
    expect(message.HTML).toContain('dir="rtl"');
    expect(message.Text).toContain('https://x/ar/verify-email?token=abc');
    expect(message.Attachments.map((a) => a.FileName)).toContain('invite.ics');
  });
});

describe('smtpTransportOptions', () => {
  const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

  it('parses a local Mailpit URL without TLS requirement', () => {
    expect(smtpTransportOptions('smtp://localhost:1025')).toEqual({
      host: 'localhost',
      port: 1025,
      secure: false,
      requireTLS: false,
      ...TIMEOUTS,
    });
    for (const host of ['127.0.0.1', 'mailpit'])
      expect(smtpTransportOptions(`smtp://${host}:1025`).requireTLS).toBe(false);
  });

  it('requires STARTTLS on a remote plain smtp host and decodes credentials', () => {
    expect(smtpTransportOptions('smtp://user%40x:p%40ss@mail.example.com:587')).toEqual({
      host: 'mail.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'user@x', pass: 'p@ss' },
      ...TIMEOUTS,
    });
  });

  it('uses implicit TLS for smtps and leaves the default port to nodemailer', () => {
    expect(smtpTransportOptions('smtps://mail.example.com')).toEqual({
      host: 'mail.example.com',
      secure: true,
      requireTLS: false,
      ...TIMEOUTS,
    });
  });

  it('rejects a non-SMTP URL', () => {
    expect(() => smtpTransportOptions('http://mail.example.com')).toThrow(/smtp/);
  });
});
