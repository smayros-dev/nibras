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

type Name = { firstName: string };

/**
 * Exact ICU arguments of each template (a wrong or missing param fails at compile time; the
 * renderer still throws at runtime). A `link` param becomes the call-to-action button (absolute
 * http(s) URL); one-time codes are named `otpCode` (log redaction rule).
 */
export type EmailParamsByKey = {
  'auth.verify_email': Name & { link: string };
  'auth.password_reset': Name & { link: string };
  /** Sent to both the old and the new address. */
  'auth.email_change_confirm': Name & { newEmail: string; link: string };
  'security.password_changed': Name;
  'security.email_changed': Name & { newEmail: string };
  'security.new_device': Name & { device: string; ip: string };
  'security.token_reuse': Name;
  'security.account_locked': Name & { minutes: number };
  'security.2fa_enabled': Name;
  'security.2fa_disabled': Name;
  'security.recovery_code_used': Name & { remaining: number };
  'phone.otp_dev': { otpCode: string };
  /** Sent to both the previous and the new owner. */
  'workspace.ownership_transferred': Name & { workspaceName: string };
  'abuse.report_received': Name;
  /** `link`: the report in the admin console. */
  'abuse.new_report': { link: string };
  /** `link`: the report in the admin console. */
  'abuse.minor_safety_reminder': { link: string };
  'admin.user_suspended': Name & { reason: string };
  'admin.user_unsuspended': Name;
};

/** ICU arguments of template `K`. */
export type EmailParams<K extends EmailTemplateKey = EmailTemplateKey> = EmailParamsByKey[K];

/** One email; `templateKey` and `params` are correlated (a union over the keys). */
export type EmailMessage<K extends EmailTemplateKey = EmailTemplateKey> = {
  [P in K]: {
    to: string;
    templateKey: P;
    locale: Locale;
    params: EmailParamsByKey[P];
    /** iCalendar invitation sent as a `text/calendar` alternative. */
    ics?: string;
  };
}[K];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** PRD §13.4 (`verifyWebhook` arrives with SP7). */
export interface EmailProvider {
  send<K extends EmailTemplateKey>(msg: EmailMessage<K>): Promise<{ providerMessageId: string }>;
}

export type SentEmail<K extends EmailTemplateKey = EmailTemplateKey> = EmailMessage<K> &
  RenderedEmail & { providerMessageId: string };
