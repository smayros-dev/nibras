import { createPrismaClient } from '@tt/db';
import Redis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { DB_HEALTH_CLIENT } from '../src/health/health.module';
import { REDIS } from '../src/redis/redis.module';
import { createTestApp } from './helpers/app';

/** A Redis client on a closed port that fails fast instead of reconnecting forever. */
function unreachableRedis(): Redis {
  const client = new Redis('redis://127.0.0.1:1', {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  return client;
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

describe('health', () => {
  it('live is 200 and ready is 200 with db+redis up', async () => {
    const { app, http } = await createTestApp();
    await http
      .get('/health/live')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ok'));
    const ready = await http.get('/health/ready').expect(200);
    expect(ready.body.info).toMatchObject({ db: { status: 'up' }, redis: { status: 'up' } });
    await app.close();
  });

  it('health routes live outside the /api/v1 prefix and carry a request id', async () => {
    const { app, http } = await createTestApp();
    const res = await http.get('/health/live').expect(200);
    expect(typeof res.headers['x-request-id']).toBe('string');
    await http.get('/api/v1/health/live').expect(404);
    await app.close();
  });

  it('ready is 503 when the database is unreachable', async () => {
    const { app, http } = await createTestApp({
      overrides: (b) =>
        b
          .overrideProvider(DB_HEALTH_CLIENT)
          .useValue(createPrismaClient('postgresql://app_user:app@localhost:1/none')),
    });
    const res = await http.get('/health/ready').expect(503);
    expect(res.body.error.db.status).toBe('down');
    expect(res.body.info.redis.status).toBe('up');
    await app.close();
  });

  it('ready is 503 when Redis is unreachable', async () => {
    const { app, http } = await createTestApp({
      overrides: (b) => b.overrideProvider(REDIS).useValue(unreachableRedis()),
    });
    const res = await http.get('/health/ready').expect(503);
    expect(res.body.error.redis.status).toBe('down');
    expect(res.body.info.db.status).toBe('up');
    await app.close();
  });

  it('ready answers 503 within the timeout instead of hanging when dependencies stall', async () => {
    const { app, http } = await createTestApp({
      overrides: (b) =>
        b
          .overrideProvider(DB_HEALTH_CLIENT)
          .useValue({
            $queryRaw: never,
            $connect: async () => undefined,
            $disconnect: async () => undefined,
          })
          .overrideProvider(REDIS)
          .useValue({ ping: never, disconnect: () => undefined }),
    });
    const started = Date.now();
    const res = await http.get('/health/ready').expect(503);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(res.body.error).toMatchObject({ db: { status: 'down' }, redis: { status: 'down' } });
    await app.close();
  });
});
