import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  EmailChangeConfirmResponse,
  EmailChangeRequestInput,
  Locale,
} from '@nibras/contracts';
import { Prisma, type GuardedClient, type User, type VerificationPurpose } from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/request-context';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { verifyPassword } from './crypto/password';
import { generateToken, hashToken } from './crypto/tokens';
import { invalidCredentials, tokenInvalid } from './password-reset.service';
import { ReauthLimiter } from './reauth-limiter';
import { lockAccountTokens } from './token-locks';

/** Both confirmation links are valid 24 h (like the email-verification link). */
export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

const SIDES = ['EMAIL_CHANGE_OLD', 'EMAIL_CHANGE_NEW'] as const satisfies VerificationPurpose[];
const sideOf = (purpose: VerificationPurpose): 'OLD' | 'NEW' =>
  purpose === 'EMAIL_CHANGE_OLD' ? 'OLD' : 'NEW';

const GONE_STATUSES = new Set<User['status']>(['DELETING', 'DELETED']);

const emailTaken = () =>
  new ApiError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'An account already exists with this email');

/** `${WEB_ORIGIN}/${locale}/confirm-email?token=${raw}` (raw is base64url: URL-safe as is). */
export function confirmEmailChangeLink(locale: Locale, raw: string): string {
  return `${env.WEB_ORIGIN.replace(/\/+$/, '')}/${locale}/confirm-email?token=${raw}`;
}

function uniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

type ConfirmOutcome =
  | { kind: 'invalid' }
  | { kind: 'pending'; pending: 'OLD' | 'NEW' }
  | {
      kind: 'changed';
      user: Pick<User, 'id' | 'firstName' | 'locale' | 'platformRole'>;
      oldEmail: string;
      newEmail: string;
    };

/**
 * Email change with double confirmation: the current address (`EMAIL_CHANGE_OLD`) and the new
 * one (`EMAIL_CHANGE_NEW`) each receive a link; the address changes only once both are confirmed,
 * in either order. One pending pair per user: a new request deletes the previous pair. Tokens
 * are stored as SHA-256 only, 24 h, single use, payload `{ newEmail }`.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    @Inject(DB) private readonly db: GuardedClient,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly limiter: ReauthLimiter,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(EmailChangeService.name);
  }

  /**
   * `POST /me/email-change`. The password is checked first (`401 INVALID_CREDENTIALS`; more than
   * 5 wrong ones in 15 min, shared with `PATCH /me/password` → `429 RATE_LIMITED`), so only the
   * account holder learns whether an address is taken (`409 EMAIL_TAKEN`, also for the user's
   * own address). Past the password, at most 3 requests per user per hour (`429`), successful
   * ones included, so a session cannot be used to flood inboxes. `input.newEmail` is trimmed and lower-cased (`EmailChangeRequestSchema`)
   * and matched case-insensitively (citext).
   */
  async request(user: AuthUser, input: EmailChangeRequestInput): Promise<void> {
    await this.limiter.attempt(user.id);
    const current = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true, firstName: true, locale: true, passwordHash: true },
    });
    if (!current.passwordHash || !(await verifyPassword(current.passwordHash, input.password))) {
      await this.auditFailure(user.id, 'invalid_credentials');
      throw invalidCredentials();
    }
    await this.limiter.succeeded(user.id);
    await this.limiter.takeEmailChangeSlot(user.id);
    const { newEmail } = input;
    const taken = await this.db.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (taken) {
      await this.auditFailure(user.id, 'email_taken');
      throw emailTaken();
    }

    const oldSide = generateToken();
    const newSide = generateToken();
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
    await this.db.$transaction(async (tx) => {
      await lockAccountTokens(tx, user.id);
      await tx.verificationToken.deleteMany({
        where: { userId: user.id, purpose: { in: [...SIDES] } },
      });
      await tx.verificationToken.createMany({
        data: [
          { purpose: 'EMAIL_CHANGE_OLD' as const, tokenHash: oldSide.hash },
          { purpose: 'EMAIL_CHANGE_NEW' as const, tokenHash: newSide.hash },
        ].map((t) => ({ ...t, userId: user.id, payload: { newEmail }, expiresAt })),
      });
    });
    await this.audit.log({
      action: 'auth.email_change_requested',
      entityType: 'User',
      entityId: user.id,
      after: { newEmail },
    });
    const params = { firstName: current.firstName, newEmail };
    await this.send(user.id, current.email, current.locale, oldSide.raw, params);
    await this.send(user.id, newEmail, current.locale, newSide.raw, params);
  }

  /**
   * `POST /auth/email-change/confirm` (public: the link may be opened on any device). Under row
   * locks on the user's account tokens (`lockAccountTokens`, `id` order): an unknown, used or expired token, or one of
   * another purpose → `410 TOKEN_INVALID`; otherwise that side is marked used. When the other
   * side is already used, the email becomes `newEmail` (verified now) in the same transaction,
   * after re-checking that no other account took the address meanwhile (`409 EMAIL_TAKEN`, the
   * unique citext index decides under races); then `security.email_changed` goes to the OLD
   * address and `auth.email_changed` is audited.
   */
  async confirm(raw: string): Promise<EmailChangeConfirmResponse> {
    const tokenHash = hashToken(raw);
    let outcome: ConfirmOutcome;
    try {
      outcome = await this.db.$transaction(async (tx): Promise<ConfirmOutcome> => {
        const target = await tx.verificationToken.findUnique({
          where: { tokenHash },
          select: { userId: true, purpose: true },
        });
        if (!target || !(SIDES as readonly VerificationPurpose[]).includes(target.purpose)) {
          return { kind: 'invalid' };
        }
        await lockAccountTokens(tx, target.userId);
        // Read after the locks: the latest committed state, which nobody else can now change.
        const pair = await tx.verificationToken.findMany({
          where: { userId: target.userId, purpose: { in: [...SIDES] } },
        });
        const now = new Date();
        const mine = pair.find((t) => t.tokenHash === tokenHash);
        if (!mine || mine.usedAt !== null || mine.expiresAt <= now) return { kind: 'invalid' };
        const other = pair.find((t) => t.purpose !== mine.purpose);
        if (!other) return { kind: 'invalid' };

        await tx.verificationToken.update({ where: { id: mine.id }, data: { usedAt: now } });
        if (other.usedAt === null) return { kind: 'pending', pending: sideOf(other.purpose) };

        const newEmail = (mine.payload as { newEmail?: unknown } | null)?.newEmail;
        const user = await tx.user.findUniqueOrThrow({ where: { id: mine.userId } });
        if (typeof newEmail !== 'string' || GONE_STATUSES.has(user.status)) {
          return { kind: 'invalid' };
        }
        const holder = await tx.user.findUnique({
          where: { email: newEmail },
          select: { id: true },
        });
        if (holder) throw emailTaken();
        await tx.user.update({
          where: { id: user.id },
          data: { email: newEmail, emailVerifiedAt: now },
        });
        // Reset links went to the old address: they no longer apply.
        await tx.verificationToken.updateMany({
          where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null },
          data: { usedAt: now },
        });
        return { kind: 'changed', user, oldEmail: user.email, newEmail };
      });
    } catch (err) {
      if (uniqueViolation(err) || (err instanceof ApiError && err.code === 'EMAIL_TAKEN')) {
        await this.auditFailure(undefined, 'email_taken');
        throw emailTaken();
      }
      throw err;
    }

    switch (outcome.kind) {
      case 'invalid':
        await this.auditFailure(undefined, 'token_invalid');
        throw tokenInvalid();
      case 'pending':
        return { pending: outcome.pending };
      case 'changed': {
        const { user, oldEmail, newEmail } = outcome;
        await this.audit.log({
          action: 'auth.email_changed',
          entityType: 'User',
          entityId: user.id,
          actorOverride: {
            userId: user.id,
            role: user.platformRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER',
          },
          before: { email: oldEmail },
          after: { email: newEmail },
        });
        await this.notify(user.id, () =>
          this.email.send({
            to: oldEmail,
            templateKey: 'security.email_changed',
            locale: user.locale,
            params: { firstName: user.firstName, newEmail },
          }),
        );
        return { pending: null };
      }
    }
  }

  private send(
    userId: string,
    to: string,
    locale: Locale,
    raw: string,
    params: { firstName: string; newEmail: string },
  ): Promise<void> {
    return this.notify(userId, () =>
      this.email.send({
        to,
        templateKey: 'auth.email_change_confirm',
        locale,
        params: { ...params, link: confirmEmailChangeLink(locale, raw) },
      }),
    );
  }

  /** A delivery failure is logged (no address, no link) and swallowed. */
  private async notify(userId: string, deliver: () => Promise<unknown>): Promise<void> {
    try {
      await deliver();
    } catch (err) {
      this.logger.error(
        { userId, err: { type: err instanceof Error ? err.name : typeof err } },
        'email change email not sent',
      );
    }
  }

  /** `userId` when the request is authenticated; the confirm route is anonymous. */
  private auditFailure(userId: string | undefined, reason: string): Promise<void> {
    return this.audit.log({
      action: 'auth.email_change_failed',
      entityType: 'User',
      entityId: userId,
      after: { reason },
    });
  }
}
