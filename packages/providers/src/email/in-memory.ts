import { randomUUID } from 'node:crypto';
import { renderEmail } from './templates';
import type { EmailMessage, EmailProvider, EmailTemplateKey, SentEmail } from './types';

/** Test double: renders like the real provider (so missing params still fail) and keeps the result. */
export class InMemoryEmailProvider implements EmailProvider {
  readonly sent: SentEmail[] = [];

  async send(msg: EmailMessage): Promise<{ providerMessageId: string }> {
    const rendered = renderEmail(msg.templateKey, msg.locale, msg.params);
    const providerMessageId = `mem-${randomUUID()}`;
    this.sent.push({ ...msg, ...rendered, providerMessageId });
    return { providerMessageId };
  }

  /** Most recent email, optionally to one recipient. */
  last(to?: string): SentEmail | undefined {
    return this.sent.findLast((m) => to === undefined || m.to === to);
  }

  findByTemplate(key: EmailTemplateKey, to?: string): SentEmail[] {
    return this.sent.filter((m) => m.templateKey === key && (to === undefined || m.to === to));
  }

  clear(): void {
    this.sent.length = 0;
  }
}
