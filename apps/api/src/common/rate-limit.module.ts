import { HttpStatus, Inject, Injectable, Module, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  normalizeIp,
  ThrottlerGuard,
  ThrottlerModule,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { UNPREFIXED_ROUTES } from '../app.setup';
import { accessTokenOf } from '../auth/cookies';
import { isPublicRequest } from '../auth/decorators/public';
import { JwtService } from '../auth/jwt.service';
import { env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { ApiError } from './api-error';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** Global API limits (PRD §8.1.2, §14.7): per authenticated user and per unauthenticated ip. */
export const RATE_LIMITS = {
  user: { limit: env.RATE_LIMIT_USER, ttlMs: 60_000 },
  anon: { limit: env.RATE_LIMIT_ANON, ttlMs: 60_000 },
} as const;

/**
 * Fixed-window counters in Redis, shared by every API instance: `INCR` + `PEXPIRE NX` + `PTTL` in
 * one `MULTI`, so the window starts at the first hit and a counter can never be left without a
 * TTL. Over the limit, the caller is blocked until the window ends (`blockDuration` is the
 * window: both throttlers are configured that way).
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number): Promise<ThrottlerStorageRecord> {
    const replies = await this.redis.multi().incr(key).pexpire(key, ttl, 'NX').pttl(key).exec();
    if (!replies) throw new Error('redis transaction aborted');
    const [hits, , pttl] = replies.map(([err, value]) => {
      if (err) throw err;
      return Number(value);
    }) as [number, number, number];
    const timeToExpire = Math.max(1, Math.ceil((pttl > 0 ? pttl : ttl) / 1000));
    const isBlocked = hits > limit;
    return {
      totalHits: hits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }
}

/** Who the request counts against, resolved once per request. */
interface Identity {
  /** Subject of a valid access JWT, if any. */
  userId: string | null;
  ip: string;
}

/** Fail-open warnings are logged at most this often (a Redis outage hits every request). */
const FAIL_OPEN_WARN_INTERVAL_MS = 60_000;
const IDENTITY = Symbol('rateLimitIdentity');
type IdentifiedRequest = Request & { [IDENTITY]?: Promise<Identity> };

/**
 * First global guard (before `JwtAuthGuard`), so failed authentications are counted too.
 * - `user` (600/min, keyed on the user id): requests carrying a valid access JWT (signature and
 *   expiry only, no database read);
 * - `anon` (60/min, keyed on the client ip — `req.ip`, i.e. `trust proxy` = `TRUST_PROXY_HOPS`;
 *   IPv6 grouped per /64): requests without a valid token AND every `@Public()` route (login,
 *   register, password reset, verify-email, refresh, the 2FA login step, …) even with one, so a
 *   token never lifts the per-ip limit of the anonymous surface (both limits then apply).
 * Counters are global per tracker (`throttle:{name}:{tracker}`), not per route. `/health/*` and
 * `/metrics` are never throttled. Over the limit → `429 RATE_LIMITED` with `details.retryAfterS`
 * and `Retry-After` (set by the exception filter).
 *
 * Redis failure: these limiters FAIL OPEN (the request proceeds, a warning is logged at most once
 * a minute): availability of the whole API outweighs a minute of unthrottled traffic, and the
 * login throttle, which guards passwords, fails closed on its own.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {
    super(options, storage, reflector);
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const path = context
      .switchToHttp()
      .getRequest<Request>()
      .path.replace(/^\/+|\/+$/g, '');
    return UNPREFIXED_ROUTES.includes(path);
  }

  private lastFailOpenWarn = 0;

  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = props;
    const who = await this.identify(context.switchToHttp().getRequest<IdentifiedRequest>());
    const isPublic = isPublicRequest(this.reflector, context);
    let tracker: string | null;
    if (throttler.name === 'user') tracker = who.userId;
    else tracker = who.userId === null || isPublic ? who.ip : null;
    if (tracker === null) return true;

    const key = tracker;
    try {
      return await super.handleRequest({ ...props, getTracker: () => key });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      this.warnFailOpen(err);
      return true;
    }
  }

  private warnFailOpen(err: unknown): void {
    const now = Date.now();
    if (now - this.lastFailOpenWarn < FAIL_OPEN_WARN_INTERVAL_MS) return;
    this.lastFailOpenWarn = now;
    this.logger.warn(
      `rate limiter unavailable, failing open (${err instanceof Error ? err.name : typeof err})`,
    );
  }

  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `throttle:${name}:${tracker}`;
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests', {
      retryAfterS: detail.timeToBlockExpire,
    });
  }

  private identify(req: IdentifiedRequest): Promise<Identity> {
    req[IDENTITY] ??= this.resolveIdentity(req);
    return req[IDENTITY];
  }

  private async resolveIdentity(req: Request): Promise<Identity> {
    const ip = req.ip ? normalizeIp(req.ip) : 'unknown';
    const token = accessTokenOf(req);
    if (token) {
      try {
        return { userId: (await this.jwt.verify(token, 'access')).sub, ip };
      } catch {
        // Invalid or expired: the request is anonymous.
      }
    }
    return { userId: null, ip };
  }
}

/**
 * `@nestjs/throttler` on Redis with two named throttlers (`user` 600/min, `anon` 60/min); the
 * guard itself is registered as the first `APP_GUARD` in `AppModule`.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis): ThrottlerModuleOptions => ({
        storage: new RedisThrottlerStorage(redis),
        // Retry-After comes from the error filter; no per-throttler X-RateLimit-* headers.
        setHeaders: false,
        throttlers: [
          { name: 'user', limit: RATE_LIMITS.user.limit, ttl: RATE_LIMITS.user.ttlMs },
          { name: 'anon', limit: RATE_LIMITS.anon.limit, ttl: RATE_LIMITS.anon.ttlMs },
        ],
      }),
    }),
  ],
})
export class RateLimitModule {}
