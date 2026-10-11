import type { Locale } from '@tt/contracts';

export type SmsTemplateKey = 'phone.otp';

export interface SmsMessage {
  /** E.164 phone number. */
  to: string;
  templateKey: SmsTemplateKey;
  locale: Locale;
  /** One-time code, named `otpCode` so loggers redact it. */
  params: { otpCode: string };
}

export interface SmsProvider {
  send(msg: SmsMessage): Promise<{ providerMessageId: string }>;
}

export interface SentSms extends SmsMessage {
  providerMessageId: string;
}
