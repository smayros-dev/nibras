// Zod-free (exported by `@nibras/contracts/web` for browser bundles); the schemas are in abuse.ts.
/** PRD §11.1 `AbuseCategory`. */
export const ABUSE_CATEGORIES = [
  'HARASSMENT',
  'INAPPROPRIATE_CONTENT',
  'IMPERSONATION',
  'MINOR_SAFETY',
  'OTHER',
] as const;
export type AbuseCategory = (typeof ABUSE_CATEGORIES)[number];

/** PRD §11.1 `AbuseReportStatus`. */
export const ABUSE_REPORT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type AbuseReportStatus = (typeof ABUSE_REPORT_STATUSES)[number];

/** PRD §11.7 `AbuseReport.entity_type`. */
export const ABUSE_ENTITY_TYPES = ['USER', 'MESSAGE', 'SESSION', 'COURSE'] as const;
export type AbuseEntityType = (typeof ABUSE_ENTITY_TYPES)[number];

/** Statuses under which the reported entity is frozen (AC-SAFE-03 `409 MESSAGE_UNDER_REVIEW`). */
export const ABUSE_UNDER_REVIEW_STATUSES = [
  'OPEN',
  'IN_REVIEW',
] as const satisfies readonly AbuseReportStatus[];

/** Statuses that close a report (`resolvedAt` is set). */
export const ABUSE_CLOSED_STATUSES = [
  'RESOLVED',
  'DISMISSED',
] as const satisfies readonly AbuseReportStatus[];

/** Delay before the MINOR_SAFETY reminder to the super-admins (AC-SAFE-05). */
export const MINOR_SAFETY_REMINDER_DELAY_MS = 24 * 3600 * 1000;
/** Job name of the MINOR_SAFETY reminder on `QUEUES.compliance`. */
export const MINOR_SAFETY_REMINDER_JOB = 'abuse.minor_safety_reminder';
/** BullMQ job id of a report's reminder (one per report: idempotent enqueueing). */
export const minorSafetyReminderJobId = (reportId: string): string =>
  `abuse:${reportId}:minor-safety-reminder`;
/** Payload of `abuse.minor_safety_reminder`: ids only. */
export interface MinorSafetyReminderJob {
  reportId: string;
}

export const ABUSE_DESCRIPTION_MIN = 10;
export const ABUSE_DESCRIPTION_MAX = 4000;
export const ABUSE_ATTACHMENTS_MAX = 10;
