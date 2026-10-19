import { describe, expect, it } from 'vitest';
import {
  DAILY_SCHEDULER_PATTERN,
  DEFAULT_JOB_OPTIONS,
  GUARDIAN_CONSENT_EXPIRE_JOB,
  GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID,
  INVITATIONS_IMPORT_JOB,
  INVITATION_EXPIRE_JOB,
  INVITATION_EXPIRE_SCHEDULER_ID,
  importJobId,
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
