import { QUEUES } from '@tt/contracts';
import { Queue, type RedisOptions } from 'bullmq';

import { redisConnection } from '../src/queues';

/** Connection for the tests' own Redis DB (`REDIS_URL_TEST`, applied in `vitest.setup.ts`). */
export const redisOpts = redisConnection(process.env.REDIS_URL);

/**
 * Removes every key of every worker queue from the test Redis DB.
 * Refuses DB 0, the development DB, so a test run never wipes live queues.
 */
export async function obliterateAllQueues(connection: RedisOptions = redisOpts): Promise<void> {
  if (!connection.db) {
    throw new Error(
      'obliterateAllQueues: refusing to obliterate queues on Redis DB 0 (set REDIS_URL_TEST to another DB index)',
    );
  }
  await Promise.all(
    Object.values(QUEUES).map(async (name) => {
      const queue = new Queue(name, { connection });
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    }),
  );
}
