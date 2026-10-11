import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@tt/db';
import type { EmailProvider } from '@tt/providers';
import type Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { REDIS } from '../redis/redis.module';
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

export type LoginThrottleCheck =
  | { allowed: true }
  | { allowed: false; code: 'RATE_LIMITED' | 'ACCOUNT_LOCKED'; retryAfterS: number };

type Keys = { ipFail: string; backoff: string; emailFail: string; lock: string };

/**
 * Login brute-force protection (PRD §8.1.2, §14.7, AC-AUTH-03), all state in Redis so every API
 * instance shares it:
 * - per ip+email (`login:fail:{sha256(email)}:{ip}`, 60 s window from the first failure): 5 free
 *   failures, then after the n-th failure the next attempt waits `min(60, 2 ** (n - 5))` s
 *   (`login:backoff:…`, a key whose TTL is the wait);
 * - per email (`login:fail:{sha256(email)}`, 15 min window): the 10th failure sets
 *   `login:lock:{sha256(email)}` for 15 min, audits `auth.account_locked` and mails the owner
 *   `security.account_locked` (once: only the request whose INCR returned exactly 10).
 * Unknown emails are counted and locked exactly like real ones, so the answers never reveal
 * whether an account exists; only the email and audit differ, and neither reaches the caller.
 * Emails are normalised (trim + lower-case) and only their SHA-256 appears in key names.
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

  /** Whether a login attempt may run now; the account lock wins over the ip+email backoff. */
  async check(email: string, ip: string): Promise<LoginThrottleCheck> {
    const k = keys(email, ip);
    const [lockTtl = -2, backoffTtl = -2] = await this.redis
      .multi()
      .pttl(k.lock)
      .pttl(k.backoff)
      .exec()
      .then(results);
    if (lockTtl > 0) return blocked('ACCOUNT_LOCKED', lockTtl);
    if (backoffTtl > 0) return blocked('RATE_LIMITED', backoffTtl);
    return { allowed: true };
  }

  /**
   * Counts one failed attempt (wrong password or unknown email). `user` is the account the email
   * belongs to, if any: the lock alert goes to it.
   */
  async recordFailure(email: string, ip: string, user?: User | null): Promise<void> {
    const k = keys(email, ip);
    // INCR + EXPIRE NX in one transaction: the window starts at the first failure, no race can
    // leave a counter without a TTL, and concurrent instances see one consistent count.
    const [ipFailures = 0, , emailFailures = 0] = await this.redis
      .multi()
      .incr(k.ipFail)
      .expire(k.ipFail, IP_WINDOW_S, 'NX')
      .incr(k.emailFail)
      .expire(k.emailFail, EMAIL_WINDOW_S, 'NX')
      .exec()
      .then(results);

    if (ipFailures >= FREE_FAILURES) {
      const waitS = Math.min(MAX_BACKOFF_S, 2 ** (ipFailures - FREE_FAILURES));
      // Only ever lengthens a running backoff: concurrent failures finishing out of order cannot
      // replace a longer wait with a shorter one (SET NX creates it, EXPIRE GT extends it).
      await this.redis
        .multi()
        .set(k.backoff, '1', 'EX', waitS, 'NX')
        .expire(k.backoff, waitS, 'GT')
        .exec()
        .then(results);
    }
    if (emailFailures === LOCK_THRESHOLD) {
      await this.redis.set(k.lock, '1', 'EX', LOCK_S);
      await this.onLocked(normaliseEmail(email), user ?? null);
    }
  }

  /** After a successful login: forgets the ip+email and email counters (not an active lock). */
  async reset(email: string, ip: string): Promise<void> {
    const k = keys(email, ip);
    await this.redis.del(k.ipFail, k.backoff, k.emailFail);
  }

  private async onLocked(email: string, user: User | null): Promise<void> {
    // Actor ANONYMOUS (unauthenticated request); an unknown email only as its SHA-256.
    await this.audit.log({
      action: 'auth.account_locked',
      entityType: 'User',
      entityId: user?.id,
      after: user
        ? { minutes: LOCK_MINUTES }
        : { emailSha256: hashToken(email), minutes: LOCK_MINUTES },
    });
    if (!user) return;
    try {
      await this.email.send({
        to: user.email,
        templateKey: 'security.account_locked',
        locale: user.locale,
        params: { firstName: user.firstName, minutes: LOCK_MINUTES },
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, err: { type: err instanceof Error ? err.name : typeof err } },
        'account locked email not sent',
      );
    }
  }
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function keys(email: string, ip: string): Keys {
  const h = hashToken(normaliseEmail(email));
  const client = ip || 'unknown';
  return {
    ipFail: `login:fail:${h}:${client}`,
    backoff: `login:backoff:${h}:${client}`,
    emailFail: `login:fail:${h}`,
    lock: `login:lock:${h}`,
  };
}

function blocked(code: 'RATE_LIMITED' | 'ACCOUNT_LOCKED', pttl: number): LoginThrottleCheck {
  return { allowed: false, code, retryAfterS: Math.max(1, Math.ceil(pttl / 1000)) };
}

/** The numeric replies of a MULTI, throwing on an aborted transaction or a failed command. */
function results(replies: [Error | null, unknown][] | null): number[] {
  if (!replies) throw new Error('redis transaction aborted');
  return replies.map(([err, value]) => {
    if (err) throw err;
    return Number(value);
  });
}
