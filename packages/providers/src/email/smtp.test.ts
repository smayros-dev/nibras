import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SmtpEmailProvider } from './smtp';

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
      from: 'TT (test) <no-reply@tt.localhost>',
    });

    const { providerMessageId } = await provider.send({
      to,
      templateKey: 'auth.verify_email',
      locale: 'ar',
      params: { firstName: 'أحمد', link: 'https://x/ar/verify-email?token=abc' },
      ics: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//tt//test//EN\r\nEND:VCALENDAR\r\n',
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
