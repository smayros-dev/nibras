import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  CONSENT_VERSIONS,
  REQUIRED_CONSENTS,
  type ConsentRecord,
  type CurrentConsentType,
} from '@tt/contracts';
import type { Consent, GuardedClient } from '@tt/db';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { RequestContext, type AuthUser } from '../common/request-context';
import { DB } from '../db/db.module';

/** Request metadata recorded on a granted consent (proof of acceptance). */
export interface ConsentMeta {
  ip: string;
  userAgent: string;
}

/** Consents a user may withdraw from their settings (this plan: marketing only). */
const REVOCABLE: readonly CurrentConsentType[] = ['MARKETING'];

/** `inet` rejects ''; `0.0.0.0` marks an unknown address. */
const UNKNOWN_IP = '0.0.0.0';

/**
 * `CONSENT_VERSIONS[type]`, read from the module binding at call time (never captured at boot),
 * so a version bump — or a test stubbing the export — applies at the very next request.
 */
function currentVersion(type: CurrentConsentType): string {
  return CONSENT_VERSIONS[type];
}

/**
 * Account-level consents (TERMS, PRIVACY, CODE_OF_CONDUCT, MARKETING; `workspaceId` NULL) of the
 * signed-in user, PRD §8.16 / AC-GDPR-06. Rows are append-only proof: a new version is a new row,
 * a withdrawal sets `revokedAt`. Reads and writes go through `db` (`app_user`), which only reaches
 * account-level consent rows.
 */
@Injectable()
export class ConsentService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'consent' | '$transaction'>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Each `REQUIRED_CONSENTS` type (in that order) without a granted, unrevoked row at its current
   * version: the `CONSENT_REQUIRED` gate and `MeUser.pendingConsents`.
   */
  async pending(userId: string): Promise<CurrentConsentType[]> {
    const held = await this.db.consent.findMany({
      where: {
        userId,
        granted: true,
        revokedAt: null,
        OR: REQUIRED_CONSENTS.map((type) => ({ type, version: currentVersion(type) })),
      },
      select: { type: true },
    });
    return REQUIRED_CONSENTS.filter((type) => !held.some((c) => c.type === type));
  }

  /**
   * Whether the user holds a granted, unrevoked `type` consent at its current version (e.g.
   * CODE_OF_CONDUCT for teacher verification: a version bump un-accepts it at the next request).
   */
  async accepted(userId: string, type: CurrentConsentType): Promise<boolean> {
    const held = await this.db.consent.findFirst({
      where: { userId, type, version: currentVersion(type), granted: true, revokedAt: null },
      select: { id: true },
    });
    return held !== null;
  }

  /** Granted rows, newest first; `current` = at today's version. */
  async list(userId: string): Promise<ConsentRecord[]> {
    const rows = await this.db.consent.findMany({
      where: { userId, granted: true },
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.flatMap((c) => {
      const type = c.type as CurrentConsentType;
      if (!(type in CONSENT_VERSIONS)) return [];
      return [
        {
          type,
          version: c.version,
          grantedAt: c.grantedAt.toISOString(),
          revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
          current: c.version === currentVersion(type),
        },
      ];
    });
  }

  /**
   * Records the acceptance of `version`, which must be today's `CONSENT_VERSIONS[type]`
   * (`422 CONSENT_VERSION_MISMATCH`, e.g. a page opened before a bump). Idempotent: an unrevoked
   * grant of that version is returned as is (no new row, no audit). Concurrent grants of one type
   * are serialised by a transaction-scoped advisory lock, so a double submit writes one row.
   */
  async grant(
    user: Pick<AuthUser, 'id'>,
    type: CurrentConsentType,
    version: string,
    meta: ConsentMeta,
  ): Promise<Consent> {
    const expected = currentVersion(type);
    if (version !== expected) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CONSENT_VERSION_MISMATCH',
        'This version is not the current one',
        { type, expected },
      );
    }
    const { consent, created } = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consent:${user.id}:${type}`}, 0))`;
      const existing = await tx.consent.findFirst({
        where: { userId: user.id, type, version, granted: true, revokedAt: null },
        orderBy: { grantedAt: 'desc' },
      });
      if (existing) return { consent: existing, created: false };
      const row = await tx.consent.create({
        data: {
          userId: user.id,
          grantedByUserId: user.id,
          type,
          version,
          granted: true,
          grantedAt: new Date(),
          ip: meta.ip || UNKNOWN_IP,
          userAgent: meta.userAgent,
        },
      });
      return { consent: row, created: true };
    });
    if (created) {
      await this.audit.log({
        action: 'consent.granted',
        entityType: 'Consent',
        entityId: consent.id,
        after: { type, version },
      });
    }
    return consent;
  }

  /**
   * Withdraws a revocable consent (`422 CONSENT_NOT_REVOCABLE` for TERMS, PRIVACY,
   * CODE_OF_CONDUCT: accepting them is a condition of using the platform). Idempotent: with
   * nothing to revoke, nothing changes and nothing is audited.
   */
  async revoke(user: Pick<AuthUser, 'id'>, type: CurrentConsentType): Promise<void> {
    if (!REVOCABLE.includes(type)) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CONSENT_NOT_REVOCABLE',
        'This consent cannot be withdrawn',
        { type },
      );
    }
    const active = await this.db.consent.findMany({
      where: { userId: user.id, type, granted: true, revokedAt: null },
    });
    if (active.length === 0) return;
    const revokedAt = new Date();
    for (const consent of active) {
      const { count } = await this.db.consent.updateMany({
        where: { id: consent.id, revokedAt: null },
        data: { revokedAt },
      });
      if (count === 0) continue; // a concurrent revoke got there first
      await this.audit.log({
        action: 'consent.revoked',
        entityType: 'Consent',
        entityId: consent.id,
        before: { type, version: consent.version, revokedAt: null },
        after: { type, version: consent.version, revokedAt },
      });
    }
  }
}

/** The request's address and user-agent (`RequestIdMiddleware`). */
export function consentMeta(): ConsentMeta {
  const store = RequestContext.get();
  return { ip: store?.ip ?? '', userAgent: store?.userAgent ?? '' };
}
