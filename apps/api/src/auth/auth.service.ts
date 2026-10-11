import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { LoginInput } from '@tt/contracts';
import type { GuardedClient, User } from '@tt/db';
import type { EmailProvider } from '@tt/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { hashPassword, verifyPassword } from './crypto/password';
import { hashToken } from './crypto/tokens';
import { deviceLabel } from './device-label';
import { SessionService, type SessionMeta, type SessionTokens } from './session.service';

export type LoginResult =
  | { status: 'OK'; user: User; tokens: SessionTokens }
  | { status: 'TWO_FACTOR_REQUIRED'; challengeToken: string };

/** Statuses that may never sign in; answered exactly like a wrong password. */
const GONE_STATUSES = new Set<User['status']>(['DELETING', 'DELETED']);

const invalidCredentials = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password');

/**
 * argon2id hash of a random password, verified against when the email is unknown so that an
 * unknown email costs the same argon2 work as a wrong password (no account enumeration by timing).
 */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHash;
}

/** Email + password sign-in (PRD §8.1.2). Rate limiting and lockout arrive with Task 8. */
@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user'>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AuthService.name);
  }

  /** Hashes the dummy password at boot rather than during the first unknown-email login. */
  async onModuleInit(): Promise<void> {
    await getDummyHash();
  }

  /**
   * `input.email` is already trimmed and lower-cased (`LoginSchema`; the column is citext too).
   * Unknown email, no password, deleted account or wrong password → `401 INVALID_CREDENTIALS`
   * (one argon2 verification in every case); right password of a suspended account →
   * `403 ACCOUNT_SUSPENDED`. Every failure is audited as `auth.login_failed` by an anonymous
   * actor. On success: a new session, `lastLoginAt`, `auth.login`, and `security.new_device` when
   * the user has no active session on a device with the same label.
   */
  async login(input: LoginInput, meta: SessionMeta): Promise<LoginResult> {
    // Before the password is read: a reset committed after this instant kills the new session.
    const authenticatedAt = new Date();
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    const hash = user?.passwordHash ?? (await getDummyHash());
    const passwordOk = await verifyPassword(hash, input.password);

    if (!user || !user.passwordHash || !passwordOk || GONE_STATUSES.has(user.status)) {
      await this.auditFailure(user, input.email, 'invalid_credentials');
      throw invalidCredentials();
    }
    if (user.status === 'SUSPENDED') {
      await this.auditFailure(user, input.email, 'suspended');
      throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'Account suspended');
    }

    // Task 10: `totpEnabledAt` set → `{ status: 'TWO_FACTOR_REQUIRED', challengeToken }`.
    const label = deviceLabel(meta.userAgent);
    const knownDevice = await this.sessions.hasActiveDevice(user.id, label);
    const tokens = await this.sessions.createSession(user, {
      ...meta,
      remember: input.remember,
      authenticatedAt,
    });
    const signedIn = await this.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      actorOverride: {
        userId: user.id,
        role: user.platformRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER',
      },
      after: {
        sessionId: tokens.session.id,
        deviceLabel: tokens.session.deviceLabel,
        remember: input.remember,
      },
    });
    if (!knownDevice) await this.sendNewDeviceEmail(user, tokens.session.deviceLabel, meta.ip);
    return { status: 'OK', user: signedIn, tokens };
  }

  /** Actor role `ANONYMOUS` (the request is unauthenticated); the email only as a SHA-256. */
  private auditFailure(user: User | null, email: string, reason: string): Promise<void> {
    return this.audit.log({
      action: 'auth.login_failed',
      entityType: 'User',
      entityId: user?.id,
      after: user ? { reason } : { emailSha256: hashToken(email), reason },
    });
  }

  private async sendNewDeviceEmail(user: User, device: string, ip: string): Promise<void> {
    try {
      await this.email.send({
        to: user.email,
        templateKey: 'security.new_device',
        locale: user.locale,
        params: { firstName: user.firstName, device, ip: ip || '-' },
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, err: { type: err instanceof Error ? err.name : typeof err } },
        'new device email not sent',
      );
    }
  }
}
