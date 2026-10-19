import { describe, expect, it } from 'vitest';
import {
  COURSE_ASSIGNED_NOTIFY_JOB,
  COURSE_PUBLISHED_NOTIFY_JOB,
  COURSE_PURGE_JOB,
  COURSE_PURGE_SCHEDULER_ID,
  COURSE_PURGE_SCHEDULER_PATTERN,
  DAILY_SCHEDULER_PATTERN,
  DEFAULT_JOB_OPTIONS,
  GUARDIAN_CONSENT_EXPIRE_JOB,
  GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID,
  INVITATIONS_IMPORT_JOB,
  INVITATION_EXPIRE_JOB,
  HOURLY_SCHEDULER_PATTERN,
  INVITATION_EXPIRE_SCHEDULER_ID,
  MEDIA_CLEANUP_JOB,
  MEDIA_CLEANUP_SCHEDULER_ID,
  MEDIA_DELETE_JOB,
  MEDIA_PROCESS_JOB,
  MEDIA_WEBHOOK_PROCESS_JOB,
  coursePublishedNotifyJobId,
  importJobId,
  mediaDeleteJobId,
  mediaProcessJobId,
  webhookProcessJobId,
} from './queues';

describe('SP2 job constants', () => {
  it('spells the job names, scheduler ids and the import job id as the plan does', () => {
    expect(INVITATIONS_IMPORT_JOB).toBe('invitations.import_csv');
    expect(importJobId('abc')).toBe('import:abc');
    expect(GUARDIAN_CONSENT_EXPIRE_JOB).toBe('guardian_consent.expire');
    expect(INVITATION_EXPIRE_JOB).toBe('invitation.expire');
    expect(GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID).toBe('guardian-consent-expire');
    expect(INVITATION_EXPIRE_SCHEDULER_ID).toBe('invitation-expire');
    expect(DAILY_SCHEDULER_PATTERN).toBe('0 3 * * *');
  });
});

describe('DEFAULT_JOB_OPTIONS', () => {
  it('retries 3 times with exponential backoff and bounded job retention', () => {
    expect(DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  });
});

describe('SP3 job constants', () => {
  it('spells the media and course jobs, job ids, scheduler ids and patterns as the plan does', () => {
    expect(MEDIA_PROCESS_JOB).toBe('media.process');
    expect(MEDIA_WEBHOOK_PROCESS_JOB).toBe('media.webhook.process');
    expect(MEDIA_CLEANUP_JOB).toBe('media.cleanup_abandoned');
    expect(MEDIA_DELETE_JOB).toBe('media.delete');
    expect(COURSE_ASSIGNED_NOTIFY_JOB).toBe('course.assigned_notify');
    expect(COURSE_PUBLISHED_NOTIFY_JOB).toBe('course.published_notify');
    expect(COURSE_PURGE_JOB).toBe('course.purge_deleted');
    expect(mediaProcessJobId('m1')).toBe('media:m1:process');
    expect(mediaDeleteJobId('m1')).toBe('media:m1:delete');
    expect(webhookProcessJobId('e1')).toBe('webhook:e1');
    expect(coursePublishedNotifyJobId('c1', 3)).toBe('course:c1:published:3');
    expect(MEDIA_CLEANUP_SCHEDULER_ID).toBe('media-cleanup-abandoned');
    expect(COURSE_PURGE_SCHEDULER_ID).toBe('course-purge-deleted');
    expect(HOURLY_SCHEDULER_PATTERN).toBe('15 * * * *');
    expect(COURSE_PURGE_SCHEDULER_PATTERN).toBe('30 3 * * *');
  });
});
