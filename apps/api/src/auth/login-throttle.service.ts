import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { normalizeIp } from '@nestjs/throttler';
import type { User } from '@tt/db';
import type { EmailProvider } from '@tt/providers';
import type Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { REDIS } from '../redis/redis.module';
import { emailHmac } from './crypto/email-hmac';
import { hashToken } from './crypto/tokens';

/** Failures per ip+email allowed inside `IP_WINDOW_S` before the exponential backoff starts. */
export const FREE_FAILURES = 5;
const IP_WINDOW_S = 60;
const MAX_BACKOFF_S = 60;
/** Failures per email inside `EMAIL_WINDOW_S` that lock the account for `LOCK_S`. */
export const LOCK_THRESHOLD = 10;
const EMAIL_WINDOW_S = 15 * 60;
export const LOCK_MINUTES = 15;
const LOCK_S = LOCK_MINUTES * 60;
/** At most one `security.account_locked` email per account per 24 h. */
const ALERT_DEDUP_S = 24 * 3600;
/**
 * Safety net for reservations never settled (process killed mid-login): an in-flight counter
 * expires this long after its last reservation. A login (argon2 + a few queries) takes far less.
 */
const INFLIGHT_TTL_S = 30;
/** Wait announced when an attempt is refused only because others are still in flight. */
const BUSY_RETRY_MS = 1000;

export type LoginThrottleCheck =
  | { allowed: true }
  | { allowed: false; code: 'RATE_LIMITED' | 'ACCOUNT_LOCKED'; retryAfterS: number };

interface Keys {
  lock: string;
  backoff: string;
  emailFail: string;
  emailInflight: string;
  ipFail: string;
  ipInflight: string;
  alerted: string;
}

/**
 * Reserves one attempt, atomically. Refuses (`{1|2, pttl}`) when the email is locked (2), the
 * ip+email backoff runs (1), the email's recorded + in-flight failures would reach the lock
 * threshold (1), or the ip+email pair already has as many attempts in flight as it has free
 * failures left (at least one once the backoff expired) (1). Otherwise counts the attempt in
 * flight for the email and the pair and returns `{0, 0}`.
 * KEYS: lock, backoff, emailFail, emailInflight, ipFail, ipInflight.
 * ARGV: free failures, lock threshold, in-flight TTL (s), busy retry (ms).
 */
const RESERVE_LUA = `
local lockTtl = redis.call('PTTL', KEYS[1])
if lockTtl > 0 then return {2, lockTtl} end
local backoffTtl = redis.call('PTTL', KEYS[2])
if backoffTtl > 0 then return {1, backoffTtl} end
local emailFail = tonumber(redis.call('GET', KEYS[3]) or '0')
local emailInflight = tonumber(redis.call('GET', KEYS[4]) or '0')
if emailFail + emailInflight >= tonumber(ARGV[2]) then return {1, tonumber(ARGV[4])} end
local ipFail = tonumber(redis.call('GET', KEYS[5]) or '0')
local ipInflight = tonumber(redis.call('GET', KEYS[6]) or '0')
if ipInflight >= math.max(1, tonumber(ARGV[1]) - ipFail) then return {1, tonumber(ARGV[4])} end
redis.call('INCR', KEYS[4])
redis.call('EXPIRE', KEYS[4], ARGV[3])
redis.call('INCR', KEYS[6])
redis.call('EXPIRE', KEYS[6], ARGV[3])
return {0, 0}
`;

/** Decrements an in-flight counter without going below zero (shared by the scripts below). */
const RELEASE_FN = `
local function release(k)
  if tonumber(redis.call('GET', k) or '0') > 0 then redis.call('DECR', k) end
end
`;

/**
 * Turns a reservation into a recorded failure, atomically: releases the in-flight slots, counts
 * the failure for the pair (60 s window) and the email (15 min window), starts or lengthens the
 * pair's backoff from the 5th failure, and at exactly the lock threshold sets the lock and claims
 * the 24 h alert slot. Returns `{ipFailures, emailFailures, locked, alert}`.
 * KEYS: emailInflight, ipInflight, ipFail, emailFail, backoff, lock, alerted.
 * ARGV: ip window, email window, free failures, max backoff, lock threshold, lock s, alert dedup s.
 */
const FAIL_LUA = `${RELEASE_FN}
release(KEYS[1])
release(KEYS[2])
local ipFail = redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], ARGV[1], 'NX')
local emailFail = redis.call('INCR', KEYS[4])
redis.call('EXPIRE', KEYS[4], ARGV[2], 'NX')
local free = tonumber(ARGV[3])
if ipFail >= free then
  local wait = math.min(tonumber(ARGV[4]), math.floor(2 ^ (ipFail - free)))
  redis.call('SET', KEYS[5], '1', 'EX', wait, 'NX')
  redis.call('EXPIRE', KEYS[5], wait, 'GT')
end
local locked = 0
local alert = 0
if emailFail == tonumber(ARGV[5]) then
  redis.call('SET', KEYS[6], '1', 'EX', ARGV[6])
  locked = 1
  if redis.call('SET', KEYS[7], '1', 'EX', ARGV[7], 'NX') then alert = 1 end
end
return {ipFail, emailFail, locked, alert}
`;

/** Releases a reservation; with ARGV[1] = '1' also forgets the pair's failures and backoff. */
const SETTLE_LUA = `${RELEASE_FN}
release(KEYS[1])
release(KEYS[2])
if ARGV[1] == '1' then redis.call('DEL', KEYS[3], KEYS[4]) end
return 0
`;

/**
 * Login brute-force protection (PRD §8.1.2, §14.7, AC-AUTH-03), all state in Redis so every API
 * instance shares it, every decision taken in one Lua script (no check-then-act race):
 * - `check` RESERVES the attempt (in-flight counters), so N concurrent requests can never all slip
 *   past the limits before the first failure is recorded;
 * - per ip+email (`login:fail:{sha256(email)}:{ip}`, 60 s window): 5 free failures, then after the
 *   n-th failure the next attempt waits `min(60, 2 ** (n - 5))` s (`login:backoff:…` TTL);
 * - per email (`login:fail:{sha256(email)}`, 15 min window): the 10th failure sets
 *   `login:lock:{sha256(email)}` for 15 min in the same script, audits `auth.account_locked` and
 *   mails the owner `security.account_locked` at most once per 24 h (`login:alerted:…`).
 * Unknown emails are counted and locked exactly like real ones (no enumeration). Emails are
 * normalised (trim + lower-case) and only their SHA-256 is in key names; ips are grouped like the
 * global limiter (`normalizeIp`, IPv6 per /64).
 *
 * Lockout-DoS trade-off (PRD lock kept, controller ruling): anyone knowing an email can keep it
 * locked by failing 10 times per 15 min. Mitigations: the alert is rate-limited to one per 24 h,
 * and a completed password reset calls `clearForEmail` (lock and counters gone), so the owner
 * always has a way back in. See docs/runbooks/login-lockout.md.
 *
 * Redis failure: this throttle FAILS CLOSED (`503 SERVICE_UNAVAILABLE` before any argon2 work):
 * without it the login is an unthrottled password oracle. The global limiters fail open.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly audit: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(LoginThrottleService.name);
  }

  /**
   * Whether a login attempt may run now; when allowed the attempt is reserved and MUST be settled
   * by `recordFailure`, `reset` (success) or `release` (any other outcome).
   */
  async check(email: string, ip: string): Promise<LoginThrottleCheck> {
    const k = keys(email, ip);
    const reply = await this.run(() =>
      this.redis.eval(
        RESERVE_LUA,
        6,
        k.lock,
        k.backoff,
        k.emailFail,
        k.emailInflight,
        k.ipFail,
        k.ipInflight,
        FREE_FAILURES,
        LOCK_THRESHOLD,
        INFLIGHT_TTL_S,
        BUSY_RETRY_MS,
      ),
    );
    const [status, pttl = 0] = numbers(reply);
    if (status === 0) return { allowed: true };
    return blocked(status === 2 ? 'ACCOUNT_LOCKED' : 'RATE_LIMITED', pttl);
  }

  /**
   * Settles a reservation as a failed attempt (wrong password or unknown email). `user` is the
   * account the email belongs to, if any: the lock alert goes to it.
   */
  async recordFailure(email: string, ip: string, user?: User | null): Promise<void> {
    const k = keys(email, ip);
    const reply = await this.run(() =>
      this.redis.eval(
        FAIL_LUA,
        7,
        k.emailInflight,
        k.ipInflight,
        k.ipFail,
        k.emailFail,
        k.backoff,
        k.lock,
        k.alerted,
        IP_WINDOW_S,
        EMAIL_WINDOW_S,
        FREE_FAILURES,
        MAX_BACKOFF_S,
        LOCK_THRESHOLD,
        LOCK_S,
        ALERT_DEDUP_S,
      ),
    );
    const [, , locked, alert] = numbers(reply);
    if (locked === 1) await this.onLocked(email, user ?? null, alert === 1);
  }

  /**
   * After a successful sign-in: settles the reservation and forgets this ip+email pair's failures
   * and backoff. The email-wide counter stays (other ips' failures still count toward the lock).
   * Never throws: the sign-in already succeeded, a stale reservation expires on its own.
   */
  async reset(email: string, ip: string): Promise<void> {
    await this.settle(email, ip, true);
  }

  /** Settles a reservation without counting it (e.g. a suspended account). Never throws. */
  async release(email: string, ip: string): Promise<void> {
    await this.settle(email, ip, false);
  }

  /**
   * Forgets the lock and every counter of `email` (all ips). Called when the owner completes a
   * password reset (Task 9's flow MUST call it), so a lockout-DoS never keeps the owner out.
   */
  async clearForEmail(email: string): Promise<void> {
    const k = keys(email, '');
    const h = emailKeyHash(email);
    const pairKeys: string[] = [];
    for (const pattern of [`login:fail:${h}:*`, `login:backoff:${h}:*`]) {
      pairKeys.push(...(await this.scan(pattern)));
    }
    await this.run(() => this.redis.del(k.lock, k.emailFail, ...pairKeys));
  }

  private async settle(email: string, ip: string, forgetPair: boolean): Promise<void> {
    const k = keys(email, ip);
    try {
      await this.redis.eval(
        SETTLE_LUA,
        4,
        k.emailInflight,
        k.ipInflight,
        k.ipFail,
        k.backoff,
        forgetPair ? '1' : '0',
      );
    } catch (err) {
      this.logger.warn({ err: errType(err) }, 'login throttle reservation not settled');
    }
  }

  /** Keys matching `pattern` (without the client's `keyPrefix`, as `del` re-adds it). */
  private async scan(pattern: string): Promise<string[]> {
    const prefix = this.redis.options.keyPrefix ?? '';
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.run(() =>
        this.redis.scan(cursor, 'MATCH', `${prefix}${pattern}`, 'COUNT', 200),
      );
      cursor = next;
      found.push(...batch.map((key) => key.slice(prefix.length)));
    } while (cursor !== '0');
    return found;
  }

  /** A Redis call; any Redis error becomes `503 SERVICE_UNAVAILABLE` (fail closed). */
  private async run<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      this.logger.warn({ err: errType(err) }, 'login throttle unavailable, failing closed');
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Service unavailable',
      );
    }
  }

  private async onLocked(email: string, user: User | null, alert: boolean): Promise<void> {
    // Actor ANONYMOUS (unauthenticated request); an unknown email only as a keyed HMAC.
    await this.audit.log({
      action: 'auth.account_locked',
      entityType: 'User',
      entityId: user?.id,
      after: user
        ? { minutes: LOCK_MINUTES }
        : { emailHmac: emailHmac(email), minutes: LOCK_MINUTES },
    });
    // Not awaited: the 10th failure of a real account answers as fast as an unknown email's.
    if (user && alert) void this.sendLockedEmail(user);
  }

  private async sendLockedEmail(user: User): Promise<void> {
    try {
      await this.email.send({
        to: user.email,
        templateKey: 'security.account_locked',
        locale: user.locale,
        params: { firstName: user.firstName, minutes: LOCK_MINUTES },
      });
    } catch (err) {
      this.logger.error({ userId: user.id, err: errType(err) }, 'account locked email not sent');
    }
  }
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailKeyHash(email: string): string {
  return hashToken(normaliseEmail(email));
}

function keys(email: string, ip: string): Keys {
  const h = emailKeyHash(email);
  const client = ip ? normalizeIp(ip) : 'unknown';
  return {
    lock: `login:lock:${h}`,
    backoff: `login:backoff:${h}:${client}`,
    emailFail: `login:fail:${h}`,
    emailInflight: `login:inflight:${h}`,
    ipFail: `login:fail:${h}:${client}`,
    ipInflight: `login:inflight:${h}:${client}`,
    alerted: `login:alerted:${h}`,
  };
}

function blocked(code: 'RATE_LIMITED' | 'ACCOUNT_LOCKED', pttl: number): LoginThrottleCheck {
  return { allowed: false, code, retryAfterS: Math.max(1, Math.ceil(pttl / 1000)) };
}

function numbers(reply: unknown): number[] {
  if (!Array.isArray(reply)) throw new Error('unexpected login throttle reply');
  return reply.map(Number);
}

function errType(err: unknown): { type: string } {
  return { type: err instanceof Error ? err.name : typeof err };
}
