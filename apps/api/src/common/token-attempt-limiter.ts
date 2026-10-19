import { Inject, Injectable } from '@nestjs/common';
import { TOKEN_ATTEMPTS_PER_MIN } from '@nibras/contracts';
import type Redis from 'ioredis';
import { hitWindow, rateLimited } from '../auth/rate-window';
import { REDIS } from '../redis/redis.module';

/** The public token surfaces counted separately (invitation links, group codes, guardian links). */
export type TokenAttemptScope = 'invite' | 'join' | 'guardian';

/** Window of the failed-lookup count, in seconds. */
export const TOKEN_ATTEMPT_WINDOW_S = 60;

/**
 * Failed token / code lookups per ip on the SP2 public routes (spec §9): past
 * {@link TOKEN_ATTEMPTS_PER_MIN} misses in a minute → `429 RATE_LIMITED`, on top of the global
 * anonymous 60 req/min. Callers run {@link assertAllowed} before the lookup and {@link failed}
 * after a miss (unknown, expired or replaced token; unknown code), so successful lookups never
 * count. Keys: `token-attempt:{scope}:{ip}`. Not registered globally: each consuming module lists
 * it in its providers (`REDIS` is global).
 */
@Injectable()
export class TokenAttemptLimiter {
  constructor(@Inject(REDIS) private readonly redis: Pick<Redis, 'multi' | 'del'>) {}

  /** Counts one failed lookup in the ip's window. */
  async failed(scope: TokenAttemptScope, ip: string): Promise<void> {
    await hitWindow(this.redis, key(scope, ip), TOKEN_ATTEMPT_WINDOW_S);
  }

  /** Refuses with `429` (`details.retryAfterS` = seconds left) once the window holds the maximum. */
  async assertAllowed(scope: TokenAttemptScope, ip: string): Promise<void> {
    const k = key(scope, ip);
    const results = await this.redis.multi().get(k).ttl(k).exec();
    if (!results) throw new Error('token attempt read aborted');
    for (const [err] of results) if (err) throw err;
    const count = Number(results[0]![1] ?? 0);
    if (count < TOKEN_ATTEMPTS_PER_MIN) return;
    const ttl = Number(results[1]![1]);
    throw rateLimited(ttl > 0 ? ttl : TOKEN_ATTEMPT_WINDOW_S, 'Too many attempts');
  }
}

function key(scope: TokenAttemptScope, ip: string): string {
  return `token-attempt:${scope}:${ip}`;
}
