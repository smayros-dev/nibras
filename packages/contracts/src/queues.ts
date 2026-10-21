/** BullMQ queue names (PRD §13.5). */
export const QUEUES = {
  sessions: 'sessions',
  notifications: 'notifications',
  media: 'media',
  imports: 'imports',
  compliance: 'compliance',
  analytics: 'analytics',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Job options every producer (API, worker) uses when enqueueing, structurally compatible with
 * BullMQ's `JobsOptions` (contracts does not depend on BullMQ).
 */
export interface DefaultJobOptions {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  /** Completed/failed jobs kept in Redis (count), for inspection. */
  removeOnComplete: number;
  removeOnFail: number;
}

export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

// SP2: students & invitations.

/** Job name of the CSV invitation import on `QUEUES.imports`. */
export const INVITATIONS_IMPORT_JOB = 'invitations.import_csv';
/**
 * BullMQ job id of an import (one job per `InvitationImport` row: idempotent enqueueing). Three
 * `:`-separated parts like `abuse:{id}:notify`: BullMQ refuses a custom id with any other number
 * of `:` (« Custom Id cannot contain : », kept for its legacy repeatable-job keys).
 */
export const importJobId = (importId: string): string => `import:${importId}:csv`;
/** Payload of `invitations.import_csv`: ids only (the rows live in `InvitationImport.rows`). */
export interface InvitationsImportJob {
  importId: string;
  workspaceId: string;
}

/** Daily job on `QUEUES.compliance`: guardian consent requests past 14 days → suspended. */
export const GUARDIAN_CONSENT_EXPIRE_JOB = 'guardian_consent.expire';
/** Daily job on `QUEUES.compliance`: stored `PENDING` invitations past `expiresAt` → `EXPIRED`. */
export const INVITATION_EXPIRE_JOB = 'invitation.expire';
/** BullMQ job scheduler ids (`upsertJobScheduler`) of the two daily jobs. */
export const GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID = 'guardian-consent-expire';
export const INVITATION_EXPIRE_SCHEDULER_ID = 'invitation-expire';
/** Cron pattern of the daily jobs (03:00 UTC). */
export const DAILY_SCHEDULER_PATTERN = '0 3 * * *';

// SP3: courses, content & media.

/** `QUEUES.media`: probe a stored object (PDF pages, image size, MP4 duration) → READY / FAILED. */
export const MEDIA_PROCESS_JOB = 'media.process';
/** `QUEUES.media`: apply one stored `WebhookEvent` (Cloudflare Stream) to its asset. */
export const MEDIA_WEBHOOK_PROCESS_JOB = 'media.webhook.process';
/** `QUEUES.media`, hourly: abandoned uploads and processing timeouts. */
export const MEDIA_CLEANUP_JOB = 'media.cleanup_abandoned';
/** `QUEUES.media`: delete a `DELETING` asset at the provider, then its row (quota decremented). */
export const MEDIA_DELETE_JOB = 'media.delete';
/** `QUEUES.notifications`: interim `course.assigned` emails (spec D14). */
export const COURSE_ASSIGNED_NOTIFY_JOB = 'course.assigned_notify';
/** `QUEUES.notifications`: interim `course.published` emails to the enrolled students. */
export const COURSE_PUBLISHED_NOTIFY_JOB = 'course.published_notify';
/** `QUEUES.compliance`, daily: hard-delete courses soft-deleted more than 30 days ago. */
export const COURSE_PURGE_JOB = 'course.purge_deleted';

/**
 * BullMQ job ids (idempotent enqueueing: one live job per asset / event / publication). BullMQ
 * accepts a custom id with no `:` or exactly three `:`-separated parts (see `assertBullmqJobId`).
 */
export const mediaProcessJobId = (mediaId: string): string => `media:${mediaId}:process`;
export const mediaDeleteJobId = (mediaId: string): string => `media:${mediaId}:delete`;
export const webhookProcessJobId = (webhookEventId: string): string =>
  `webhook:${webhookEventId}:process`;
/** One notification job per publication (a re-publish has a new course version). */
export const coursePublishedNotifyJobId = (courseId: string, version: number): string =>
  `course:${courseId}:published-v${version}`;

/** BullMQ job scheduler ids (`upsertJobScheduler`). */
export const MEDIA_CLEANUP_SCHEDULER_ID = 'media-cleanup-abandoned';
export const COURSE_PURGE_SCHEDULER_ID = 'course-purge-deleted';
/** Cron pattern of the hourly media cleanup (minute 15). */
export const HOURLY_SCHEDULER_PATTERN = '15 * * * *';
/** Cron pattern of the daily course purge (03:30 UTC). */
export const COURSE_PURGE_SCHEDULER_PATTERN = '30 3 * * *';

/** Payload of `media.process`. */
export interface MediaProcessJob {
  mediaId: string;
  workspaceId: string;
}
/** Payload of `media.webhook.process` (the event row holds the body). */
export interface MediaWebhookProcessJob {
  webhookEventId: string;
}
/** Payload of `media.delete`. */
export interface MediaDeleteJob {
  mediaId: string;
  workspaceId: string;
}
/** Payload of `course.assigned_notify`: ids only. */
export interface CourseAssignedNotifyJob {
  workspaceId: string;
  enrollmentIds: string[];
}
/** Payload of `course.published_notify`. */
export interface CoursePublishedNotifyJob {
  workspaceId: string;
  courseId: string;
}
