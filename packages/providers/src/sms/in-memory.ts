import { randomUUID } from 'node:crypto';
import type { SentSms, SmsMessage, SmsProvider } from './types';

/** Test double keeping every message, one-time code included. */
export class InMemorySmsProvider implements SmsProvider {
  readonly sent: SentSms[] = [];

  async send(msg: SmsMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `mem-${randomUUID()}`;
    this.sent.push({ ...msg, providerMessageId });
    return { providerMessageId };
  }

  /** Most recent message, optionally to one recipient. */
  last(to?: string): SentSms | undefined {
    return this.sent.findLast((m) => to === undefined || m.to === to);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
