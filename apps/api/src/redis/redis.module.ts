import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

/** Injection token for the shared `ioredis` client on `REDIS_URL`. */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
        // Without a listener ioredis prints "Unhandled error event" on every reconnect attempt.
        client.on('error', (err: Error) => logger.warn(`redis error: ${err.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Pick<Redis, 'disconnect'>) {}

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
