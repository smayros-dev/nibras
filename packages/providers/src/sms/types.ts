import type { Locale } from '@nibras/contracts';

/** Every SMS of SP1; texts live in `@nibras/i18n` under `sms.<key>` (`renderSms`). */
export const SMS_TEMPLATE_KEYS = ['phone.otp'] as const;

export type SmsTemplateKey = (typeof SMS_TEMPLATE_KEYS)[number];

/** ICU arguments of each SMS template; one-time codes are named `otpCode` (log redaction rule). */
export type SmsParamsByKey = {
  'phone.otp': { otpCode: string };
};

export interface SmsMessage {
  /** E.164 phone number. */
  to: string;
  templateKey: SmsTemplateKey;
  locale: Locale;
  /** One-time code, named `otpCode` so loggers redact it. */
  params: SmsParamsByKey[SmsTemplateKey];
}

export interface SmsProvider {
  send(msg: SmsMessage): Promise<{ providerMessageId: string }>;
}

export interface SentSms extends SmsMessage {
  providerMessageId: string;
}
