import { randomUUID } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { SmsMessage, SmsProvider } from './types';

/** The subset of a pino logger this provider needs. */
export interface SmsLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Masks a phone number for logs: keeps `+` and the country calling code and the last 2 digits
 * (`+21620000000` → `+216******00`); an unparsable value keeps only its last 2 characters.
 */
export function maskPhone(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone);
  if (parsed) {
    const national = parsed.nationalNumber;
    return `+${parsed.countryCallingCode}${'*'.repeat(Math.max(national.length - 2, 0))}${national.slice(-2)}`;
  }
  return phone.length <= 2
    ? '*'.repeat(phone.length)
    : `${'*'.repeat(phone.length - 2)}${phone.slice(-2)}`;
}

/**
 * Development/CI provider (`SMS_PROVIDER=console`): sends nothing. Logs the masked recipient,
 * template and locale at info; the `otpCode` only at debug, where `REDACT_KEYS` still masks it.
 */
export class LogSmsProvider implements SmsProvider {
  constructor(private readonly logger: SmsLogger) {}

  async send(msg: SmsMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `log-${randomUUID()}`;
    const { templateKey, locale } = msg;
    this.logger.info(
      { to: maskPhone(msg.to), templateKey, locale, providerMessageId },
      'SMS not sent (log provider)',
    );
    this.logger.debug({ providerMessageId, otpCode: msg.params.otpCode }, 'SMS one-time code');
    return { providerMessageId };
  }
}
