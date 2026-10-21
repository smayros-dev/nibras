import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  defaultWorkspaceSettings,
  type CreateOrganizationInput,
  type UpdateWorkspaceInput,
  type WorkspaceDetail,
  type WorkspaceStorage,
} from '@nibras/contracts';
import {
  crossTenantDb,
  Prisma,
  tenantDb,
  uuidv7,
  withTenantTx,
  type GuardedClient,
  type MembershipRole,
  type TenantTx,
  type User,
  type Workspace,
} from '@nibras/db';
import type { EmailParams, EmailProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { uniqueViolationOn } from '../common/prisma-errors';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { permissionDenied } from '../tenancy/permissions';
import { slugify, uniqueSlug } from './slug';
import { lockMemberships, lockWorkspace, readSettings } from './workspace-settings.service';

const GIB = 1024n ** 3n;
/** D-P15: a personal workspace holds 20 GiB. */
export const PERSONAL_STORAGE_QUOTA_BYTES = 20n * GIB;
/** D-P15: an organisation holds 200 GiB. */
export const ORGANIZATION_STORAGE_QUOTA_BYTES = 200n * GIB;
/** A slug collision (32^6 suffixes) retries the whole transaction with a fresh suffix. */
export const SLUG_ATTEMPTS = 3;

/** What creating a workspace needs to know about its owner. */
export type WorkspaceOwner = Pick<User, 'id' | 'firstName' | 'locale' | 'timezone'>;

/**
 * A caller's tenant transaction to create the PERSONAL workspace in: `tx` was opened with
 * `withTenantTx(workspaceId, …)`, so the workspace must take that very id.
 */
export interface PersonalWorkspaceTx {
  tx: TenantTx;
  workspaceId: string;
}

/** Roles whose ACTIVE membership in an organisation makes `allowPersonalWorkspaces` apply (D-O7). */
const D_O7_ROLES: MembershipRole[] = ['TEACHER', 'ADMIN'];

/** Workspace fields `PATCH /workspaces/{wid}` may change, in audit order. */
const UPDATABLE_KEYS = [
  'name',
  'country',
  'defaultTimezone',
  'defaultLocale',
  'allowPersonalWorkspaces',
] as const satisfies readonly (keyof UpdateWorkspaceInput & keyof Workspace)[];

/** `ApiError` 422 shaped like a zod failure, for rules the request schema cannot see. */
export function validationFailed(path: string, message: string): ApiError {
  return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', 'Validation failed', {
    issues: [{ path: [path], message }],
  });
}

/** Retries `fn` (a whole transaction) when the random slug suffix collided. */
async function withSlugRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < SLUG_ATTEMPTS && uniqueViolationOn(err, 'slug')) continue;
      throw err;
    }
  }
}

/** The API view of a workspace with the caller's membership there. */
export function toWorkspaceDetail(
  w: Workspace,
  me: { role: MembershipRole; canTeach: boolean },
): WorkspaceDetail {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    type: w.type,
    status: w.status,
    country: w.country,
    defaultTimezone: w.defaultTimezone,
    defaultLocale: w.defaultLocale,
    allowPersonalWorkspaces: w.allowPersonalWorkspaces,
    createdAt: w.createdAt.toISOString(),
    myRole: me.role,
    myCanTeach: me.canTeach,
  };
}

const AS_OWNER = { role: 'OWNER', canTeach: false } as const;

/**
 * Workspaces (PRD §8.2): PERSONAL workspace on sign-up and for invited teachers (D-O7),
 * organisations, workspace fields, storage, soft delete and ownership transfer.
 */
@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace' | 'user'>,
    private readonly audit: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(WorkspacesService.name);
  }

  /**
   * The PERSONAL workspace of `owner` (`Espace de {prénom}`, slug `slugify(name)-xxxxxx`, 20 GiB,
   * settings defaulted on the owner's time zone) with its ACTIVE OWNER membership. Inside the
   * caller's transaction when `tx` is given (registration: the caller retries on a slug
   * collision); otherwise in its own transaction, retried on a slug collision. Not audited: the
   * caller records why it was created.
   */
  async createPersonal(owner: WorkspaceOwner, tx?: PersonalWorkspaceTx): Promise<Workspace> {
    if (tx) return this.insertPersonal(tx.tx, tx.workspaceId, owner);
    return withSlugRetry(() => {
      const id = uuidv7();
      return withTenantTx(id, (t) => this.insertPersonal(t, id, owner));
    });
  }

  /**
   * `POST /me/personal-workspace` (AC-WS-08). `409 PERSONAL_WORKSPACE_EXISTS` when the user
   * already owns a PERSONAL workspace, whatever its status (a DELETING one still counts until
   * SP11 purges it, so delete/recreate never yields a second one or a fresh quota); `403
   * PERSONAL_WORKSPACE_FORBIDDEN` with `{ organizationId, organizationName }` when an organisation
   * where the user holds an ACTIVE TEACHER/ADMIN membership has `allowPersonalWorkspaces = false`
   * (the oldest such membership); otherwise creates it and audits `workspace.created`. A
   * per-user advisory lock serialises concurrent calls, so a user never gets two.
   */
  async createPersonalForInvitedTeacher(user: WorkspaceOwner): Promise<WorkspaceDetail> {
    const workspace = await withSlugRetry(() => {
      const id = uuidv7();
      return withTenantTx(id, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`personal-workspace:${user.id}`}, 0))`;
        const existing = await tx.workspace.findFirst({
          where: { ownerUserId: user.id, type: 'PERSONAL' },
          select: { id: true },
        });
        if (existing) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'PERSONAL_WORKSPACE_EXISTS',
            'You already have a personal workspace',
          );
        }
        await this.assertNoOrganizationForbids(user.id);
        return this.insertPersonal(tx, id, user);
      });
    });
    await this.audit.log({
      action: 'workspace.created',
      entityType: 'Workspace',
      entityId: workspace.id,
      workspaceId: workspace.id,
      after: this.creationSnapshot(workspace),
    });
    return toWorkspaceDetail(workspace, AS_OWNER);
  }

  /**
   * `POST /workspaces`: an ORGANIZATION (200 GiB, `allowPersonalWorkspaces: true`, default time
   * zone and settings `default_timezone` = `input.timezone`, locale = the owner's) with the
   * caller as ACTIVE OWNER; audits `workspace.created`.
   */
  async createOrganization(
    owner: WorkspaceOwner,
    input: CreateOrganizationInput,
  ): Promise<WorkspaceDetail> {
    const workspace = await withSlugRetry(() => {
      const id = uuidv7();
      return withTenantTx(id, async (tx) => {
        const created = await tx.workspace.create({
          data: {
            id,
            type: 'ORGANIZATION',
            name: input.name,
            slug: uniqueSlug(slugify(input.name)),
            ownerUserId: owner.id,
            country: input.country ?? null,
            defaultTimezone: input.timezone,
            defaultLocale: owner.locale,
            storageQuotaBytes: ORGANIZATION_STORAGE_QUOTA_BYTES,
            allowPersonalWorkspaces: true,
            settings: { ...defaultWorkspaceSettings(input.timezone) },
          },
        });
        await tx.membership.create({
          data: {
            workspaceId: id,
            userId: owner.id,
            role: 'OWNER',
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });
        return created;
      });
    });
    await this.audit.log({
      action: 'workspace.created',
      entityType: 'Workspace',
      entityId: workspace.id,
      workspaceId: workspace.id,
      after: this.creationSnapshot(workspace),
    });
    return toWorkspaceDetail(workspace, AS_OWNER);
  }

  /** `GET /workspaces/{wid}` for the caller's membership (loaded by `WorkspaceContextGuard`). */
  async detail(
    wid: string,
    me: { role: MembershipRole; canTeach: boolean },
  ): Promise<WorkspaceDetail> {
    const w = await this.db.workspace.findUniqueOrThrow({ where: { id: wid } });
    return toWorkspaceDetail(w, me);
  }

  /**
   * `PATCH /workspaces/{wid}`: `allowPersonalWorkspaces` on a PERSONAL workspace → `422`. A new
   * `defaultTimezone` is copied into the settings' `default_timezone`. Audits
   * `workspace.updated` with before/after of the fields that changed (nothing changed → no
   * write, no audit). The workspace row is locked for the read-modify-write of `settings`.
   */
  async update(
    wid: string,
    input: UpdateWorkspaceInput,
    me: { role: MembershipRole; canTeach: boolean },
  ): Promise<WorkspaceDetail> {
    const { workspace, before, after } = await withTenantTx(wid, async (tx) => {
      await lockWorkspace(tx, wid);
      const current = await tx.workspace.findUniqueOrThrow({ where: { id: wid } });
      if (input.allowPersonalWorkspaces !== undefined && current.type !== 'ORGANIZATION') {
        throw validationFailed(
          'allowPersonalWorkspaces',
          'allowPersonalWorkspaces only applies to an organisation',
        );
      }
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of UPDATABLE_KEYS) {
        const next = input[key];
        if (next === undefined || next === current[key]) continue;
        before[key] = current[key];
        after[key] = next;
      }
      if (Object.keys(after).length === 0) return { workspace: current, before, after };

      const data: Prisma.WorkspaceUpdateInput = { ...after };
      if (after.defaultTimezone !== undefined) {
        const settings = readSettings(current);
        data.settings = { ...settings, default_timezone: after.defaultTimezone as string };
      }
      const updated = await tx.workspace.update({ where: { id: wid }, data });
      return { workspace: updated, before, after };
    });
    if (Object.keys(after).length > 0) {
      await this.audit.log({
        action: 'workspace.updated',
        entityType: 'Workspace',
        entityId: wid,
        before,
        after,
      });
    }
    return toWorkspaceDetail(workspace, me);
  }

  /**
   * `GET /workspaces/{wid}/storage`: `storageQuotaBytes` / `storageUsedBytes` as strings, plus the
   * declared sizes of the workspace's `UPLOADING` assets (`reservedBytes`, SP3 spec D17).
   */
  async storage(wid: string): Promise<WorkspaceStorage> {
    const w = await this.db.workspace.findUniqueOrThrow({
      where: { id: wid },
      select: { storageQuotaBytes: true, storageUsedBytes: true },
    });
    const reserved = await tenantDb(wid).mediaAsset.aggregate({
      where: { status: 'UPLOADING', deletedAt: null },
      _sum: { sizeBytes: true },
    });
    return {
      quotaBytes: w.storageQuotaBytes.toString(),
      usedBytes: w.storageUsedBytes.toString(),
      reservedBytes: (reserved._sum.sizeBytes ?? 0n).toString(),
    };
  }

  /**
   * `DELETE /workspaces/{wid}` (OWNER only): status `DELETING`, `deletedAt = now`; the workspace
   * becomes read-only (`423` on mutations) and SP11 purges it after 30 days. Audits
   * `workspace.deleted`.
   */
  async softDelete(wid: string): Promise<void> {
    const current = await this.db.workspace.findUniqueOrThrow({
      where: { id: wid },
      select: { status: true },
    });
    const deletedAt = new Date();
    await this.db.workspace.update({
      where: { id: wid },
      data: { status: 'DELETING', deletedAt },
    });
    await this.audit.log({
      action: 'workspace.deleted',
      entityType: 'Workspace',
      entityId: wid,
      before: { status: current.status },
      after: { status: 'DELETING', deletedAt },
    });
  }

  /**
   * `POST /workspaces/{wid}/transfer-ownership` (AC-WS-04). PERSONAL → `409
   * NOT_AN_ORGANIZATION`. In one transaction, with the workspace row and both membership rows
   * locked (`lockWorkspace`, `lockMemberships`) and re-read under the locks: the caller must still
   * be the ACTIVE OWNER and `Workspace.ownerUserId` (else `403`), the target an ACTIVE ADMIN (else
   * `422`); the caller's OWNER membership becomes ADMIN (keeping `canTeach`), then the target's
   * becomes OWNER, `Workspace.ownerUserId` follows (spec SP1.6 F7). Then the
   * `workspace.ownership_transferred` audit row and the email to both.
   */
  async transferOwnership(wid: string, fromUserId: string, toUserId: string): Promise<void> {
    const workspace = await this.db.workspace.findUniqueOrThrow({
      where: { id: wid },
      select: { type: true, name: true },
    });
    if (workspace.type !== 'ORGANIZATION') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'NOT_AN_ORGANIZATION',
        'Only an organisation can change owner',
      );
    }
    await withTenantTx(wid, async (tx) => {
      await lockWorkspace(tx, wid);
      await lockMemberships(tx, wid, [fromUserId, toUserId]);
      // Re-read under the locks: a concurrent transfer, removal or role change has either
      // committed (and is seen here) or waits for this transaction.
      const owner = await tx.workspace.findUniqueOrThrow({
        where: { id: wid },
        select: { ownerUserId: true },
      });
      const members = await tx.membership.findMany({
        where: { userId: { in: [fromUserId, toUserId] } },
        select: { id: true, userId: true, role: true, status: true },
      });
      const caller = members.find((m) => m.userId === fromUserId);
      const target = members.find((m) => m.userId === toUserId);
      // The caller lost ownership to a concurrent transfer.
      if (
        !caller ||
        caller.role !== 'OWNER' ||
        caller.status !== 'ACTIVE' ||
        owner.ownerUserId !== fromUserId
      ) {
        throw permissionDenied();
      }
      if (!target || target.role !== 'ADMIN' || target.status !== 'ACTIVE') {
        throw validationFailed(
          'toUserId',
          'The new owner must be an active admin of the workspace',
        );
      }
      // Demote first: `membership_owner_per_workspace_key` allows one OWNER at any instant. A
      // unique violation here cannot happen under the locks; it surfaces as a 500 on purpose.
      await tx.membership.update({ where: { id: caller.id }, data: { role: 'ADMIN' } });
      await tx.membership.update({ where: { id: target.id }, data: { role: 'OWNER' } });
      await tx.workspace.update({ where: { id: wid }, data: { ownerUserId: toUserId } });
    });

    await this.audit.log({
      action: 'workspace.ownership_transferred',
      entityType: 'Workspace',
      entityId: wid,
      before: { ownerUserId: fromUserId },
      after: { ownerUserId: toUserId },
    });
    const users = await this.db.user.findMany({
      where: { id: { in: [fromUserId, toUserId] } },
      select: { id: true, email: true, firstName: true, locale: true },
    });
    for (const u of users) {
      await this.sendEmail(u, { firstName: u.firstName, workspaceName: workspace.name });
    }
  }

  private async insertPersonal(
    tx: TenantTx,
    workspaceId: string,
    owner: WorkspaceOwner,
  ): Promise<Workspace> {
    const name = `Espace de ${owner.firstName}`;
    const workspace = await tx.workspace.create({
      data: {
        id: workspaceId,
        type: 'PERSONAL',
        name,
        slug: uniqueSlug(slugify(name)),
        ownerUserId: owner.id,
        defaultTimezone: owner.timezone,
        defaultLocale: owner.locale,
        storageQuotaBytes: PERSONAL_STORAGE_QUOTA_BYTES,
        settings: { ...defaultWorkspaceSettings(owner.timezone) },
      },
    });
    await tx.membership.create({
      data: {
        workspaceId,
        userId: owner.id,
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    return workspace;
  }

  /**
   * D-O7: the first organisation (oldest membership) where the user is an ACTIVE TEACHER/ADMIN
   * and personal workspaces are forbidden → `403 PERSONAL_WORKSPACE_FORBIDDEN`.
   */
  private async assertNoOrganizationForbids(userId: string): Promise<void> {
    const memberships = await crossTenantDb().membership.findMany({
      where: { userId, status: 'ACTIVE', role: { in: D_O7_ROLES } },
      select: { workspaceId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (memberships.length === 0) return;
    const forbidding = await this.db.workspace.findMany({
      where: {
        id: { in: memberships.map((m) => m.workspaceId) },
        type: 'ORGANIZATION',
        allowPersonalWorkspaces: false,
      },
      select: { id: true, name: true },
    });
    const first = memberships
      .map((m) => forbidding.find((w) => w.id === m.workspaceId))
      .find((w) => w !== undefined);
    if (first) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'PERSONAL_WORKSPACE_FORBIDDEN',
        'An organisation you teach in does not allow personal workspaces',
        { organizationId: first.id, organizationName: first.name },
      );
    }
  }

  private creationSnapshot(w: Workspace): Record<string, unknown> {
    return {
      type: w.type,
      name: w.name,
      slug: w.slug,
      country: w.country,
      defaultTimezone: w.defaultTimezone,
      storageQuotaBytes: w.storageQuotaBytes,
    };
  }

  /** Best effort: the transfer is committed, a failed email is logged and never surfaces. */
  private async sendEmail(
    user: Pick<User, 'id' | 'email' | 'locale'>,
    params: EmailParams<'workspace.ownership_transferred'>,
  ): Promise<void> {
    try {
      await this.email.send({
        to: user.email,
        templateKey: 'workspace.ownership_transferred',
        locale: user.locale,
        params,
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, err: { type: err instanceof Error ? err.name : typeof err } },
        'ownership transfer email not sent',
      );
    }
  }
}
