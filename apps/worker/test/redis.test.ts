import { describe, expect, it } from 'vitest';

import { redisConnection } from '../src/queues';
import { obliterateAllQueues } from './redis';

describe('obliterateAllQueues', () => {
  it('refuses to wipe Redis DB 0 (the development DB)', async () => {
    await expect(obliterateAllQueues(redisConnection('redis://localhost:6379'))).rejects.toThrow(
      /refusing to obliterate.*DB 0/,
    );
    await expect(obliterateAllQueues(redisConnection('redis://localhost:6379/0'))).rejects.toThrow(
      /DB 0/,
    );
  });
});
