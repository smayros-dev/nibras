import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  INVITE_LINK_DEFAULT_MAX_USES,
  INVITE_LINK_DEFAULT_TTL_DAYS,
  joinLink,
  type CreateInviteLinkInput,
  type InviteLink as InviteLinkView,
  type InviteLinkStatus,
  type UpdateInviteLinkInput,
} from '@nibras/contracts';
import {
  Prisma,
  tenantDb,
  withTenantTx,
  type GuardedClient,
  type InviteLink,
  type TenantTx,
  type Workspace,
} from '@nibras/db';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { uniqueViolationOn } from '../common/prisma-errors';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { studentTeacherFor } from '../invitations/invitations.service';
import type { MemberCtx } from '../members/members.service';
import { validationFailed } from '../workspaces/workspaces.service';
import { generateInviteCode } from './code';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 3600 * 1000;
/** `expiresAt` may be at most one year ahead (design §4.3). */
const MAX_TTL_MS = 365 * DAY_MS;
/** Code collisions (≈ 1.1 × 10¹² codes) are retried this many times before giving up. */
const CODE_ATTEMPTS = 5;

type LinkWorkspace = Pick<Workspace, 'id' | 'type' | 'defaultLocale'>;

/** The status the staff and the join page see: a stored `ACTIVE` past `expiresAt` is `EXPIRED`. */
export function derivedLinkStatus(
  row: Pick<InviteLink, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): InviteLinkStatus {
  return row.status === 'ACTIVE' && row.expiresAt !== null && row.expiresAt <= now
    ? 'EXPIRED'
    : row.status;
}

function toView(row: InviteLink, workspace: LinkWorkspace, now = new Date()): InviteLinkView {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    requiresApproval: row.requiresApproval,
    maxUses: row.maxUses,
    usesCount: row.usesCount,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    status: derivedLinkStatus(row, now),
    createdByUserId: row.createdByUserId,
    teacherUserId: row.teacherUserId,
    courseIds: row.courseIds,
    createdAt: row.createdAt.toISOString(),
    url: joinLink(env.WEB_ORIGIN, workspace.defaultLocale, row.code),
  };
}

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

/** `expiresAt` in the future and at most a year ahead, else `422` on `expiresAt`. */
function checkExpiry(expiresAt: Date, now: Date): Date {
  if (expiresAt <= now) throw validationFailed('expiresAt', 'Must be in the future');
  if (expiresAt.getTime() - now.getTime() > MAX_TTL_MS) {
    throw validationFailed('expiresAt', 'Must be at most one year ahead');
  }
  return expiresAt;
}

/** Keys an update may change, in the order they are audited. */
const UPDATABLE = ['label', 'status', 'maxUses', 'expiresAt', 'requiresApproval'] as const;

/**
 * Group invite links of a workspace (PRD §8.3.3, design §4.3): STUDENT codes with a use limit,
 * an expiry and an optional approval queue. Every query runs through `tenantDb(wid)` /
 * `withTenantTx(wid)`: an id of another workspace is never found (404). Scope `own`
 * (organisation TEACHER): the links he created. Rows are never deleted (`DELETE` disables them:
 * the audit trail keeps pointing at them).
 */
@Injectable()
export class InviteLinksService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace'>,
    private readonly audit: AuditService,
  ) {}

  /** `GET /workspaces/{wid}/invite-links`: newest first, no pagination (a handful per workspace). */
  async list(ctx: MemberCtx): Promise<InviteLinkView[]> {
    const workspace = await this.workspace(ctx.workspaceId);
    const rows = await tenantDb(ctx.workspaceId).inviteLink.findMany({
      where: this.visible(ctx),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const now = new Date();
    return rows.map((r) => toView(r, workspace, now));
  }

  /**
   * `POST /workspaces/{wid}/invite-links`. Defaults: approval required in an ORGANIZATION (not in
   * a PERSONAL workspace), `INVITE_LINK_DEFAULT_MAX_USES` uses, `INVITE_LINK_DEFAULT_TTL_DAYS`
   * days; `expiresAt` in the future and at most a year ahead (`422`). `teacherUserId` follows the
   * invitation rules (`studentTeacherFor`). The code is drawn at random and retried on a
   * collision. Audits `invite_link.created`.
   */
  async create(ctx: MemberCtx, input: CreateInviteLinkInput): Promise<InviteLinkView> {
    const workspace = await this.workspace(ctx.workspaceId);
    const now = new Date();
    const expiresAt = input.expiresAt
      ? checkExpiry(new Date(input.expiresAt), now)
      : new Date(now.getTime() + INVITE_LINK_DEFAULT_TTL_DAYS * DAY_MS);
    const teacherUserId = await studentTeacherFor(
      ctx,
      workspace.type === 'ORGANIZATION',
      input.teacherUserId,
    );
    const data = {
      workspaceId: ctx.workspaceId,
      label: input.label || null,
      role: 'STUDENT' as const,
      createdByUserId: ctx.userId,
      teacherUserId,
      courseIds: input.courseIds,
      requiresApproval: input.requiresApproval ?? workspace.type === 'ORGANIZATION',
      maxUses: input.maxUses ?? INVITE_LINK_DEFAULT_MAX_USES,
      expiresAt,
      status: 'ACTIVE' as const,
    };
    let row: InviteLink | undefined;
    for (let attempt = 1; !row; attempt += 1) {
      try {
        row = await tenantDb(ctx.workspaceId).inviteLink.create({
          data: { ...data, code: generateInviteCode() },
        });
      } catch (err) {
        if (attempt < CODE_ATTEMPTS && uniqueViolationOn(err, 'code')) continue;
        throw err;
      }
    }
    await this.audit.log({
      action: 'invite_link.created',
      entityType: 'InviteLink',
      entityId: row.id,
      after: {
        code: row.code,
        label: row.label,
        maxUses: row.maxUses,
        expiresAt: row.expiresAt,
        requiresApproval: row.requiresApproval,
        teacherUserId: row.teacherUserId,
      },
    });
    return toView(row, workspace, now);
  }

  /**
   * `PATCH /workspaces/{wid}/invite-links/{id}`. `status` toggles `ACTIVE` / `DISABLED`; a link
   * that is not disabled is stored `EXHAUSTED` exactly when `usesCount >= maxUses` (raising
   * `maxUses` reopens an exhausted link); `maxUses` below `usesCount` → `422`; `expiresAt: null`
   * removes the expiry, a date must be in the future and at most a year ahead. Runs under a row
   * lock so a concurrent join cannot interleave with the use counter. Audits
   * `invite_link.updated` with before/after of the keys that changed (none → no write).
   */
  async update(ctx: MemberCtx, id: string, input: UpdateInviteLinkInput): Promise<InviteLinkView> {
    const workspace = await this.workspace(ctx.workspaceId);
    const now = new Date();
    const { before, after, row } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const current = await this.lock(tx, ctx, id);
      const maxUses = input.maxUses ?? current.maxUses;
      if (maxUses < current.usesCount) {
        throw validationFailed('maxUses', 'Must not be below the uses already counted');
      }
      let expiresAt = current.expiresAt;
      if (input.expiresAt !== undefined) {
        expiresAt = input.expiresAt === null ? null : checkExpiry(new Date(input.expiresAt), now);
      }
      const wanted = input.status ?? (current.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE');
      const status: InviteLink['status'] =
        wanted === 'DISABLED' ? 'DISABLED' : current.usesCount >= maxUses ? 'EXHAUSTED' : 'ACTIVE';
      const next = {
        label: input.label === undefined ? current.label : input.label || null,
        status,
        maxUses,
        expiresAt,
        requiresApproval: input.requiresApproval ?? current.requiresApproval,
      };
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of UPDATABLE) {
        const was = current[key];
        const value = next[key];
        const same =
          was instanceof Date || value instanceof Date
            ? (was as Date | null)?.getTime() === (value as Date | null)?.getTime()
            : was === value;
        if (same) continue;
        before[key] = was;
        after[key] = value;
      }
      if (Object.keys(after).length === 0) return { before, after, row: current };
      const row = await tx.inviteLink.update({ where: { id: current.id }, data: after });
      return { before, after, row };
    });
    if (Object.keys(after).length > 0) {
      await this.audit.log({
        action: 'invite_link.updated',
        entityType: 'InviteLink',
        entityId: row.id,
        before,
        after,
      });
    }
    return toView(row, workspace, now);
  }

  /**
   * `DELETE /workspaces/{wid}/invite-links/{id}`: the link becomes `DISABLED` (kept for the audit
   * trail; its code answers `410 INVITE_LINK_DISABLED`). Idempotent. Audits `invite_link.updated`
   * when the status changed.
   */
  async disable(ctx: MemberCtx, id: string): Promise<void> {
    const changed = await withTenantTx(ctx.workspaceId, async (tx) => {
      const current = await this.lock(tx, ctx, id);
      if (current.status === 'DISABLED') return null;
      await tx.inviteLink.update({ where: { id: current.id }, data: { status: 'DISABLED' } });
      return current;
    });
    if (!changed) return;
    await this.audit.log({
      action: 'invite_link.updated',
      entityType: 'InviteLink',
      entityId: changed.id,
      before: { status: changed.status },
      after: { status: 'DISABLED' },
    });
  }

  /** Rows the caller may see: his own under scope `own`. */
  private visible(ctx: MemberCtx): Prisma.InviteLinkWhereInput {
    return ctx.scope === 'own' ? { createdByUserId: ctx.userId } : {};
  }

  /** One visible link of the route's workspace, locked (`FOR UPDATE`) for the transaction; else 404. */
  private async lock(tx: TenantTx, ctx: MemberCtx, id: string): Promise<InviteLink> {
    if (!UUID.test(id)) throw notFound();
    const visible = await tx.inviteLink.findFirst({
      where: { AND: [{ id }, this.visible(ctx)] },
      select: { id: true },
    });
    if (!visible) throw notFound();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "invite_link" WHERE id = ${id}::uuid FOR UPDATE`);
    return tx.inviteLink.findFirstOrThrow({ where: { id } });
  }

  private workspace(wid: string): Promise<LinkWorkspace> {
    return this.db.workspace.findUniqueOrThrow({
      where: { id: wid },
      select: { id: true, type: true, defaultLocale: true },
    });
  }
}
