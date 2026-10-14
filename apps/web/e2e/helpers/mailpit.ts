/** Mailpit's API (dev SMTP sink), `docker-compose.yml`: 8025 HTTP, 1025 SMTP. */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export interface ReceivedEmail {
  html: string;
  text: string;
  subject: string;
}

/**
 * Polls Mailpit until an email to `to` whose subject/html/text contains `templateHint`
 * (e.g. `'verify-email'` matches the link path in the html) arrives; gives up after 30 s.
 */
export async function waitForEmail(to: string, templateHint: string): Promise<ReceivedEmail> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    if (res.ok) {
      const data = (await res.json()) as { messages?: { ID: string }[] };
      for (const message of data.messages ?? []) {
        const full = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`);
        if (!full.ok) continue;
        const body = (await full.json()) as { HTML?: string; Text?: string; Subject?: string };
        const email: ReceivedEmail = {
          html: body.HTML ?? '',
          text: body.Text ?? '',
          subject: body.Subject ?? '',
        };
        if (`${email.subject} ${email.html} ${email.text}`.includes(templateHint)) return email;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email to ${to} matching "${templateHint}" within 30 s`);
}

/** First `href` in `html` whose URL contains `pathContains`, HTML entities decoded. */
export function extractLink(html: string, pathContains: string): string | null {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1]?.replace(/&amp;/g, '&');
    if (href?.includes(pathContains)) return href;
  }
  return null;
}
