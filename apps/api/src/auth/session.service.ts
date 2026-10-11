import { hkdfSync } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SessionSummary } from '@tt/contracts';
import { uuidv7, type GuardedClient, type User, type UserSession } from '@tt/db';
import type { EmailProvider } from '@tt/providers';
import type Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { REDIS } from '../redis/redis.module';
import { REFRESH_TTL_MS } from './cookies';
import { SecretBox } from './crypto/secret-box';
import { generateToken, hashToken, safeEqual } from './crypto/tokens';
import { deviceLabel } from './device-label';
import { JwtService } from './jwt.service';

/** Request metadata recorded on a session. */
export interface SessionMeta {
  ip: string;
  userAgent: string;
}

export interface SessionTokens {
  session: UserSession;
  accessToken: string;
  /** `${session.id}.${raw}`; only `sha256(raw)` is stored. */
  refreshToken: string;
}

/**
 * Benign-race window: how long the outcome of a rotation stays available to requests that
 * presented the same refresh token *before* that rotation happened (see {@link SessionService}).
 */
export const ROTATION_GRACE_S = 30;

/** `inet` rejects ''; `0.0.0.0` marks an unknown address. */
const UNKNOWN_IP = '0.0.0.0';
const USER_AGENT_MAX = 512;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `generateToken()` output: 32 bytes as base64url. */
const RAW = /^[A-Za-z0-9_-]{43}$/;

/** Wall-clock milliseconds with sub-millisecond resolution (comparable across instances). */
const wallClockMs = (): number => performance.timeOrigin + performance.now();

const unauthenticated = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
export const sessionRevoked = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'SESSION_REVOKED', 'Session revoked or expired');

/** Splits `${sid}.${raw}`; `null` when malformed. */
export function parseRefreshToken(token: string): { sid: string; raw: string } | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const sid = token.slice(0, dot);
  const raw = token.slice(dot + 1);
  return UUID.test(sid) && RAW.test(raw) ? { sid: sid.toLowerCase(), raw } : null;
}

/** What a rotation left in Redis for concurrent requests holding the same (now spent) token. */
interface GraceEntry {
  /** The new raw token, sealed (AES-256-GCM, key derived from `JWT_SECRET`). */
  sealed: string;
  /** Wall-clock ms at which the winning request took the row lock. */
  rotatedAt: number;
  /** sha256 of the winning request's user-agent. */
  ua: string;
}

type RotateOutcome =
  | { kind: 'unknown' }
  | { kind: 'dead'; session: UserSession; current: boolean }
  | { kind: 'rotated'; session: UserSession; raw: string }
  | {
      kind: 'reuse';
      session: UserSession;
      user: Pick<User, 'email' | 'firstName' | 'locale'>;
      revoked: number;
    };

/**
 * Sessions and their rotating refresh tokens (PRD §8.1.2, AC-AUTH-04, AC-AUTH-07).
 *
 * One `UserSession` row per sign-in is one refresh-token family (`familyId = id`): every rotation
 * replaces `refreshTokenHash` in place, so only the latest token of a family is ever valid. The
 * session expires 30 days after sign-in whatever the activity (absolute lifetime; the refresh
 * cookie is persistent only with "remember me").
 *
 * Rotation is serialised per session by a row lock (`SELECT … FOR UPDATE` in a transaction).
 * Presenting a token that is not the current one of a live session is reuse: the family is
 * revoked, the owner gets `security.token_reuse`, and `auth.refresh_reuse_detected` is audited.
 *
 * Benign race policy: a browser can send the same refresh cookie twice in parallel (two tabs, a
 * retried request). The request that takes the lock first rotates and leaves the new raw token
 * (sealed) in Redis for {@link ROTATION_GRACE_S}; a request that presented the same token and had
 * already *started before that rotation* (wall clock at entry < `rotatedAt`), with the same
 * user-agent, receives the winner's token instead of triggering reuse detection. A request that
 * starts after the rotation (a replay, however soon) is reuse. Clock skew between API instances
 * can only make that comparison stricter or looser by the skew itself.
 *
 * A token presented for a revoked or expired session is a plain `401 SESSION_REVOKED` without
 * email: after a logout or "Déconnecter partout" the other devices still hold their (current)
 * cookie, and a family already revoked for reuse has nothing left to protect.
 */
@Injectable()
export class SessionService {
  private readonly graceBox = new SecretBox(
    Buffer.from(
      hkdfSync('sha256', env.JWT_SECRET, Buffer.alloc(0), 'tt/refresh-rotation-grace', 32),
    ).toString('base64'),
  );

  constructor(
    @Inject(DB) private readonly db: GuardedClient,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'set' | 'get'>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(SessionService.name);
  }

  /** A new session (and family) for `user`, with its first access and refresh tokens. */
  async createSession(
    user: Pick<User, 'id'>,
    meta: SessionMeta & { remember: boolean },
  ): Promise<SessionTokens> {
    const id = uuidv7();
    const { raw, hash } = generateToken();
    const now = new Date();
    const userAgent = meta.userAgent.slice(0, USER_AGENT_MAX);
    const session = await this.db.userSession.create({
      data: {
        id,
        userId: user.id,
        refreshTokenHash: hash,
        familyId: id,
        deviceLabel: deviceLabel(userAgent),
        ip: meta.ip || UNKNOWN_IP,
        userAgent,
        remember: meta.remember,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      },
    });
    return {
      session,
      accessToken: await this.jwt.signAccess({ sub: user.id, sid: id }),
      refreshToken: `${id}.${raw}`,
    };
  }

  /**
   * Exchanges a refresh token for a new pair (see the class comment for the race policy).
   * Malformed or unknown → `401 UNAUTHENTICATED`; revoked or expired session →
   * `401 SESSION_REVOKED`; reuse → the family is revoked and `'REUSE'` is returned.
   */
  async rotate(refreshToken: string, meta: SessionMeta): Promise<SessionTokens | 'REUSE'> {
    const startedAt = wallClockMs();
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) throw unauthenticated();
    const presented = hashToken(parsed.raw);

    const outcome = await this.db.$transaction(async (tx): Promise<RotateOutcome> => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM user_session WHERE id = ${parsed.sid}::uuid FOR UPDATE`;
      if (locked.length === 0) return { kind: 'unknown' };
      const row = await tx.userSession.findUniqueOrThrow({
        where: { id: parsed.sid },
        include: { user: { select: { email: true, firstName: true, locale: true } } },
      });
      const { user, ...session } = row;
      const current = safeEqual(session.refreshTokenHash, presented);
      if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
        return { kind: 'dead', session, current };
      }
      if (current) {
        const next = generateToken();
        const entry: GraceEntry = {
          sealed: this.graceBox.seal(next.raw),
          rotatedAt: wallClockMs(),
          ua: hashToken(meta.userAgent),
        };
        // Written before the commit, so a request queued on the row lock finds it.
        await this.redis.set(graceKey(presented), JSON.stringify(entry), 'EX', ROTATION_GRACE_S);
        const updated = await tx.userSession.update({
          where: { id: session.id },
          data: { refreshTokenHash: next.hash, lastSeenAt: new Date(), ip: meta.ip || UNKNOWN_IP },
        });
        return { kind: 'rotated', session: updated, raw: next.raw };
      }
      const replay = await this.concurrentReplay(presented, startedAt, meta, session);
      if (replay !== null) return { kind: 'rotated', session, raw: replay };
      const { count } = await tx.userSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { kind: 'reuse', session, user, revoked: count };
    });

    switch (outcome.kind) {
      case 'unknown':
        throw unauthenticated();
      case 'dead':
        if (!outcome.current) await this.auditReuse(outcome.session, 0);
        throw sessionRevoked();
      case 'reuse':
        await this.auditReuse(outcome.session, outcome.revoked);
        await this.sendReuseEmail(outcome.user, outcome.session.userId);
        return 'REUSE';
      case 'rotated':
        return {
          session: outcome.session,
          accessToken: await this.jwt.signAccess({
            sub: outcome.session.userId,
            sid: outcome.session.id,
          }),
          refreshToken: `${outcome.session.id}.${outcome.raw}`,
        };
    }
  }

  /** Revokes one session (its whole family); `false` when it was not active. */
  async revoke(sessionId: string): Promise<boolean> {
    const { count } = await this.db.userSession.updateMany({
      where: { familyId: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0;
  }

  /** Revokes every active session of `userId` but `except`; returns how many were revoked. */
  async revokeAll(userId: string, except?: string): Promise<number> {
    const { count } = await this.db.userSession.updateMany({
      where: { userId, revokedAt: null, ...(except !== undefined && { id: { not: except } }) },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** The active (unrevoked, unexpired) sessions of `userId`, most recently seen first. */
  async listActive(userId: string, currentSessionId?: string): Promise<SessionSummary[]> {
    const rows = await this.db.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      select: { id: true, deviceLabel: true, ip: true, createdAt: true, lastSeenAt: true },
    });
    return rows.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  /** Whether session `sessionId` (active or not) belongs to `userId`. */
  async isOwnedBy(sessionId: string, userId: string): Promise<boolean> {
    const found = await this.db.userSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    return found !== null;
  }

  /** Whether `userId` has an active session on a device with this label. */
  async hasActiveDevice(userId: string, label: string): Promise<boolean> {
    const found = await this.db.userSession.findFirst({
      where: { userId, deviceLabel: label, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * The raw token a concurrent winner rotated `presented` into, if this request qualifies for
   * the benign-race policy and that token is still the session's current one.
   */
  private async concurrentReplay(
    presented: string,
    startedAt: number,
    meta: SessionMeta,
    session: UserSession,
  ): Promise<string | null> {
    const stored = await this.redis.get(graceKey(presented));
    if (stored === null) return null;
    let entry: GraceEntry;
    let raw: string;
    try {
      entry = JSON.parse(stored) as GraceEntry;
      raw = this.graceBox.open(entry.sealed);
    } catch {
      return null;
    }
    if (!(startedAt < entry.rotatedAt)) return null;
    if (!safeEqual(entry.ua, hashToken(meta.userAgent))) return null;
    return safeEqual(hashToken(raw), session.refreshTokenHash) ? raw : null;
  }

  private auditReuse(session: UserSession, revoked: number): Promise<void> {
    return this.audit.log({
      action: 'auth.refresh_reuse_detected',
      entityType: 'UserSession',
      entityId: session.familyId,
      after: { userId: session.userId, familyId: session.familyId, revokedSessions: revoked },
    });
  }

  private async sendReuseEmail(
    user: Pick<User, 'email' | 'firstName' | 'locale'>,
    userId: string,
  ): Promise<void> {
    try {
      await this.email.send({
        to: user.email,
        templateKey: 'security.token_reuse',
        locale: user.locale,
        params: { firstName: user.firstName },
      });
    } catch (err) {
      this.logger.error(
        { userId, err: { type: err instanceof Error ? err.name : typeof err } },
        'token reuse email not sent',
      );
    }
  }
}

function graceKey(presentedHash: string): string {
  return `auth:refresh-grace:${presentedHash}`;
}
