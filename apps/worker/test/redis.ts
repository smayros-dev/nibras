import { QUEUES } from '@tt/contracts';
import { Queue } from 'bullmq';

import { redisConnection } from '../src/queues';

/** Connection for the test's own Redis DB index (from `REDIS_URL`, e.g. `/8`). */
export const redisOpts = redisConnection(process.env.REDIS_URL);

/** Removes every key of every worker queue from the test Redis DB. */
export async function obliterateAllQueues(): Promise<void> {
  await Promise.all(
    Object.values(QUEUES).map(async (name) => {
      const queue = new Queue(name, { connection: redisOpts });
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    }),
  );
}
