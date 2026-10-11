import type { Locale } from '@tt/contracts';

/** Every transactional email of SP1; messages live in `@tt/i18n` under `emails.<key>`. */
export const EMAIL_TEMPLATE_KEYS = [
  'auth.verify_email',
  'auth.password_reset',
  'auth.email_change_confirm',
  'security.password_changed',
  'security.email_changed',
  'security.new_device',
  'security.token_reuse',
  'security.account_locked',
  'security.2fa_enabled',
  'security.2fa_disabled',
  'security.recovery_code_used',
  'phone.otp_dev',
  'workspace.ownership_transferred',
  'abuse.report_received',
  'abuse.new_report',
  'abuse.minor_safety_reminder',
  'admin.user_suspended',
  'admin.user_unsuspended',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

/**
 * ICU arguments of a template. A `link` param becomes the call-to-action button; one-time codes
 * are named `otpCode` (log redaction rule).
 */
export type EmailParams = Record<string, string | number>;

export interface EmailMessage {
  to: string;
  templateKey: EmailTemplateKey;
  locale: Locale;
  params: EmailParams;
  /** iCalendar invitation sent as a `text/calendar` alternative. */
  ics?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** PRD §13.4 (`verifyWebhook` arrives with SP7). */
export interface EmailProvider {
  send(msg: EmailMessage): Promise<{ providerMessageId: string }>;
}

export interface SentEmail extends EmailMessage, RenderedEmail {
  providerMessageId: string;
}
