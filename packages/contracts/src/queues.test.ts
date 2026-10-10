import { describe, expect, it } from 'vitest';
import { DEFAULT_JOB_OPTIONS } from './queues';

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
