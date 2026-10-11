import { randomUUID } from 'node:crypto';
import type { SmsMessage, SmsProvider } from './types';

/** The subset of a pino logger this provider needs. */
export interface SmsLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Development/CI provider (`SMS_PROVIDER=console`): sends nothing. Logs recipient, template and
 * locale at info; the `otpCode` only at debug, where `REDACT_KEYS` still masks it.
 */
export class LogSmsProvider implements SmsProvider {
  constructor(private readonly logger: SmsLogger) {}

  async send(msg: SmsMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `log-${randomUUID()}`;
    const { to, templateKey, locale } = msg;
    this.logger.info({ to, templateKey, locale, providerMessageId }, 'SMS not sent (log provider)');
    this.logger.debug({ providerMessageId, otpCode: msg.params.otpCode }, 'SMS one-time code');
    return { providerMessageId };
  }
}
