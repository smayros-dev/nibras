import { Inject, Injectable } from '@nestjs/common';
import {
  generateOpaqueToken,
  GUARDIAN_CONSENT_RESEND_WINDOW_S,
  GUARDIAN_CONSENT_TTL_MS,
  guardianConsentLink,
  maskEmail,
} from '@nibras/contracts';
import type { GuardianLink, TenantTx, User, Workspace } from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { rateLimited } from '../auth/rate-window';
import { env } from '../config/env';
import { formatMailDate } from '../invitations/invitation-mailer.service';
import { EMAIL_PROVIDER } from '../providers/providers.module';

export interface StartGuardianRequest {
  workspaceId: string;
  studentUserId: string;
  guardianEmail: string;
}

/** A consent request armed in a transaction; `raw` goes into the emailed link only. */
export interface ArmedGuardianRequest {
  link: GuardianLink;
  raw: string;
}

type Person = Pick<User, 'firstName' | 'lastName'>;

const fullName = (p: Person): string => `${p.firstName} ${p.lastName}`.trim();

/**
 * The shared "start a consent cycle" primitive of D-O5 (one `GuardianLink` per (student,
 * workspace)): used by the invitation acceptance (SP2 T5), the join-code acceptance and the
 * approval queue (T6) and the guardian resend routes (T7). `start` / `resend` run inside the
 * caller's `withTenantTx(workspaceId)`; `notify` runs after the commit (audit + email). The raw
 * token is never logged, audited or queued: it only reaches the guardian's email.
 */
@Injectable()
export class GuardianRequestService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(GuardianRequestService.name);
  }

  /**
   * Arms the 14-day consent request of (student, workspace): a new `PENDING` link, or the existing
   * row (whatever its status: `PENDING`, `REFUSED`, `REVOKED`) re-armed — `status PENDING`, the
   * given guardian email, a new token hash (the previous link stops working), `consentExpiresAt =
   * now + 14 d`, `consentSentAt = now`, `decidedAt` cleared; `consentResentCount`, the guardian
   * page token and the consent history are kept. Callers handle an `ACTIVE` link with an
   * unrevoked consent themselves (nothing to ask).
   */
  async start(tx: TenantTx, input: StartGuardianRequest): Promise<ArmedGuardianRequest> {
    const { raw, hash } = generateOpaqueToken();
    const now = new Date();
    const armed = {
      status: 'PENDING' as const,
      guardianEmail: input.guardianEmail,
      consentTokenHash: hash,
      consentExpiresAt: new Date(now.getTime() + GUARDIAN_CONSENT_TTL_MS),
      consentSentAt: now,
      decidedAt: null,
    };
    const link = await tx.guardianLink.upsert({
      where: {
        studentUserId_workspaceId: {
          studentUserId: input.studentUserId,
          workspaceId: input.workspaceId,
        },
      },
      create: { workspaceId: input.workspaceId, studentUserId: input.studentUserId, ...armed },
      update: armed,
    });
    return { link, raw };
  }

  /**
   * A new consent link for a pending request: `429 RATE_LIMITED` (`details.retryAfterS`) while
   * the last send is younger than `GUARDIAN_CONSENT_RESEND_WINDOW_S`; else a new token (the
   * previous link stops working), `consentExpiresAt = now + 14 d`, `consentSentAt = now`,
   * `consentResentCount + 1` — one conditional update, so two concurrent resends arm one link.
   */
  async resend(tx: TenantTx, link: GuardianLink): Promise<ArmedGuardianRequest> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - GUARDIAN_CONSENT_RESEND_WINDOW_S * 1000);
    const cooldown = (sentAt: Date | null) => {
      if (sentAt && sentAt > windowStart) {
        const left = GUARDIAN_CONSENT_RESEND_WINDOW_S - (now.getTime() - sentAt.getTime()) / 1000;
        throw rateLimited(Math.max(1, Math.ceil(left)), 'Consent request already sent');
      }
    };
    cooldown(link.consentSentAt);
    const { raw, hash } = generateOpaqueToken();
    const { count } = await tx.guardianLink.updateMany({
      where: {
        id: link.id,
        OR: [{ consentSentAt: null }, { consentSentAt: { lte: windowStart } }],
      },
      data: {
        consentTokenHash: hash,
        consentExpiresAt: new Date(now.getTime() + GUARDIAN_CONSENT_TTL_MS),
        consentSentAt: now,
        consentResentCount: { increment: 1 },
      },
    });
    if (count !== 1) {
      throw rateLimited(GUARDIAN_CONSENT_RESEND_WINDOW_S, 'Consent request already sent');
    }
    return { link: await tx.guardianLink.findFirstOrThrow({ where: { id: link.id } }), raw };
  }

  /**
   * After the commit: audits `guardian.consent_requested` (masked guardian email, expiry) and
   * emails `guardian.consent_requested` to the guardian in the workspace's default locale (the
   * guardian has no account), naming the student, the workspace and the teacher, with the
   * `/{locale}/guardian-consent/{raw}` link. A delivery failure is logged (identifiers only) and
   * swallowed: the student's waiting panel and the teacher can resend.
   */
  async notify(input: {
    link: GuardianLink;
    raw: string;
    student: Person;
    workspace: Pick<Workspace, 'id' | 'name' | 'defaultLocale' | 'defaultTimezone'>;
    teacher: Person;
  }): Promise<void> {
    const { link, raw, workspace } = input;
    await this.audit.log({
      action: 'guardian.consent_requested',
      entityType: 'GuardianLink',
      entityId: link.id,
      workspaceId: link.workspaceId,
      after: {
        studentUserId: link.studentUserId,
        guardianEmailMasked: maskEmail(link.guardianEmail),
        consentExpiresAt: link.consentExpiresAt,
      },
    });
    try {
      const locale = workspace.defaultLocale;
      await this.email.send({
        to: link.guardianEmail,
        templateKey: 'guardian.consent_requested',
        locale,
        params: {
          studentName: fullName(input.student),
          workspaceName: workspace.name,
          teacherName: fullName(input.teacher),
          link: guardianConsentLink(env.WEB_ORIGIN, locale, raw),
          expiresAt: formatMailDate(link.consentExpiresAt!, locale, workspace.defaultTimezone),
        },
      });
    } catch (err) {
      this.logger.error(
        {
          guardianLinkId: link.id,
          workspaceId: link.workspaceId,
          err: { type: err instanceof Error ? err.name : typeof err },
        },
        'guardian consent email not sent',
      );
    }
  }
}
