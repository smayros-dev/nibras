import type { InvitableRole, Locale, MediaFailureReason } from '@nibras/contracts';

/** Every transactional email of SP1, SP2 and SP3; messages live in `@nibras/i18n` under `emails.<key>`. */
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
  'invitation.received_student',
  'invitation.received_staff',
  'invitation.accepted',
  'guardian.consent_requested',
  'guardian.consent_confirmation',
  'guardian.consent_granted',
  'guardian.consent_granted_teacher',
  'guardian.consent_refused',
  'guardian.consent_revoked',
  'guardian.consent_expired',
  'join.approved',
  'join.rejected',
  'imports.completed',
  'media.failed',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

type Name = { firstName: string };

/** An ICU `select` discriminator for an optional string (ICU cannot test a string for emptiness). */
type YesNo = 'yes' | 'no';

/** The workspace and the teacher every SP2 template names (PRD §18 row 2, AC-I18N-02). */
type WorkspaceTeacher = { workspaceName: string; teacherName: string };

/** Guardian decision notices: one template, `recipientRole` selects the sentence. */
type GuardianDecision = Name &
  WorkspaceTeacher & { studentName: string; recipientRole: 'STUDENT' | 'TEACHER'; link: string };

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
  /**
   * `hasName: 'no'` → neutral greeting (`firstName` may be empty); `hasMessage: 'no'` → no
   * personal-message paragraph. `expiresAt` (here and below) is a date already formatted in the
   * recipient's locale and time zone (`formatDate`, AC-I18N-02).
   */
  'invitation.received_student': {
    hasName: YesNo;
    firstName: string;
    inviterName: string;
    workspaceName: string;
    hasMessage: YesNo;
    message: string;
    link: string;
    expiresAt: string;
  };
  'invitation.received_staff': {
    inviterName: string;
    workspaceName: string;
    role: Exclude<InvitableRole, 'STUDENT'>;
    link: string;
    expiresAt: string;
  };
  /** To the inviter (`firstName`); `link`: the students page. */
  'invitation.accepted': Name & { memberName: string; workspaceName: string; link: string };
  /** To the guardian; `link`: the public consent page. */
  'guardian.consent_requested': WorkspaceTeacher & {
    studentName: string;
    link: string;
    expiresAt: string;
  };
  /** To the guardian; `link`: the guardian page (sessions + revoke). */
  'guardian.consent_confirmation': WorkspaceTeacher & { studentName: string; link: string };
  /** To the student. */
  'guardian.consent_granted': Name & WorkspaceTeacher & { studentName: string; link: string };
  /** To the inviting teacher or the workspace owner. */
  'guardian.consent_granted_teacher': Name &
    WorkspaceTeacher & { studentName: string; link: string };
  'guardian.consent_refused': GuardianDecision;
  'guardian.consent_revoked': GuardianDecision;
  'guardian.consent_expired': GuardianDecision;
  /** To the student. */
  'join.approved': Name & WorkspaceTeacher & { link: string };
  'join.rejected': Name & WorkspaceTeacher & { link: string };
  /** To the importer (`firstName`); `link`: the pending tab of the students page. */
  'imports.completed': Name & {
    workspaceName: string;
    created: number;
    failed: number;
    link: string;
  };
  /**
   * To the media owner when processing fails (worker, spec §4.3, AC-MED-03); `reason` selects the
   * explanation; `link`: the course editor (or the workspace's course list).
   */
  'media.failed': Name & { filename: string; reason: MediaFailureReason; link: string };
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
