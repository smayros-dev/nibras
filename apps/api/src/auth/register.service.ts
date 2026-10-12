import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CONSENT_VERSIONS, REQUIRED_CONSENTS, type RegisterTeacherInput } from '@tt/contracts';
import { uuidv7, withTenantTx, type GuardedClient, type User, type Workspace } from '@tt/db';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { uniqueViolationOn } from '../common/prisma-errors';
import { DB } from '../db/db.module';
import { SLUG_ATTEMPTS, WorkspacesService } from '../workspaces/workspaces.service';
import { hashPassword } from './crypto/password';
import { PasswordPolicy } from './crypto/password-policy';
import { EmailVerificationService } from './email-verification.service';
import { TEACHER_REGISTERED, TeacherRegisteredEvent } from './events';

/** Request metadata recorded on the consents. */
export interface RegistrationMeta {
  ip: string;
  userAgent: string;
}

/** `inet` rejects ''; `0.0.0.0` marks an unknown address (Express always knows the socket's). */
const UNKNOWN_IP = '0.0.0.0';

const emailTaken = () =>
  new ApiError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'An account already exists with this email');

/**
 * "Je suis professeur" sign-up (PRD §8.1.1, AC-AUTH-01). Registration may reveal that an email is
 * taken (`409 EMAIL_TAKEN`, planner ruling); password reset never does.
 */
@Injectable()
export class RegisterService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user'>,
    private readonly policy: PasswordPolicy,
    private readonly verification: EmailVerificationService,
    private readonly audit: AuditService,
    private readonly workspaces: WorkspacesService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RegisterService.name);
  }

  /**
   * Validates the password (`422 PASSWORD_*`), then in ONE transaction creates the user (ACTIVE,
   * email unverified), the PERSONAL workspace with its OWNER membership, the TERMS + PRIVACY
   * consents at their current versions and the `EMAIL_VERIFY` token. After the commit: the
   * verification email, the `auth.registered` audit entry and `TeacherRegisteredEvent`.
   * `input.email` is already trimmed and lower-cased by `RegisterTeacherSchema` (the column is
   * citext as well, so case variants collide either way).
   */
  async registerTeacher(
    input: RegisterTeacherInput,
    meta: RegistrationMeta,
  ): Promise<{ user: User; workspace: Workspace }> {
    const check = await this.policy.validate(input.password);
    if (!check.ok) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, check.code, 'Password rejected');
    }
    // Spares the argon2 hash for a known duplicate; the unique index still decides under races.
    const existing = await this.db.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) throw emailTaken();
    const passwordHash = await hashPassword(input.password);
    const now = new Date();
    const ip = meta.ip || UNKNOWN_IP;

    let created: { user: User; workspace: Workspace; rawToken: string } | undefined;
    for (let attempt = 1; !created; attempt += 1) {
      const workspaceId = uuidv7();
      try {
        created = await withTenantTx(workspaceId, async (tx) => {
          const user = await tx.user.create({
            data: {
              email: input.email,
              passwordHash,
              firstName: input.firstName,
              lastName: input.lastName,
              locale: input.locale,
              timezone: input.timezone,
              status: 'ACTIVE',
            },
          });
          const workspace = await this.workspaces.createPersonal(user, { tx, workspaceId });
          await tx.consent.createMany({
            data: REQUIRED_CONSENTS.map((type) => ({
              userId: user.id,
              type,
              version: CONSENT_VERSIONS[type],
              granted: true,
              grantedAt: now,
              ip,
              userAgent: meta.userAgent,
            })),
          });
          const token = this.verification.newToken(user.id);
          await tx.verificationToken.create({ data: token.data });
          return { user, workspace, rawToken: token.raw };
        });
      } catch (err) {
        if (uniqueViolationOn(err, 'email')) throw emailTaken();
        if (uniqueViolationOn(err, 'slug') && attempt < SLUG_ATTEMPTS) continue;
        throw err;
      }
    }

    const { user, workspace, rawToken } = created;
    await this.verification.send(user, rawToken);
    await this.audit.log({
      action: 'auth.registered',
      entityType: 'User',
      entityId: user.id,
      workspaceId: workspace.id,
      after: {
        kind: input.kind,
        locale: user.locale,
        timezone: user.timezone,
        workspaceId: workspace.id,
        consents: REQUIRED_CONSENTS.map((type) => CONSENT_VERSIONS[type]),
      },
    });
    this.publishRegistered(new TeacherRegisteredEvent(user.id, workspace.id, user.locale, now));
    return { user, workspace };
  }

  /**
   * Fire-and-forget: the registration is committed, so a listener's failure (sync throw or
   * rejection) is logged and never reaches the HTTP response.
   */
  private publishRegistered(event: TeacherRegisteredEvent): void {
    const failed = (err: unknown) =>
      this.logger.error(
        { err: { type: err instanceof Error ? err.name : typeof err }, userId: event.userId },
        'TeacherRegisteredEvent listener failed',
      );
    try {
      this.events.emitAsync(TEACHER_REGISTERED, event).catch(failed);
    } catch (err) {
      failed(err);
    }
  }
}
