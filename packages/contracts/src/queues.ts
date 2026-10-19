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
/** BullMQ job id of an import (one job per `InvitationImport` row: idempotent enqueueing). */
export const importJobId = (importId: string): string => `import:${importId}`;
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
