import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  defaultWorkspaceSettings,
  WorkspaceSettingsSchema,
  type WorkspaceSettings,
  type WorkspaceSettingsPatch,
} from '@nibras/contracts';
import {
  Prisma,
  withTenantTx,
  type GuardedClient,
  type TenantTx,
  type Workspace,
} from '@nibras/db';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { DB } from '../db/db.module';

/**
 * `SELECT … FOR UPDATE` on the workspace row: serialises the read-modify-write of `settings`
 * (and ownership changes) for the rest of `tx`.
 */
export async function lockWorkspace(tx: TenantTx, wid: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT 1 FROM "workspace" WHERE id = ${wid}::uuid FOR UPDATE`);
}

/**
 * `SELECT … FOR UPDATE` on the memberships of `userIds` in `wid` (missing ones are skipped), in
 * `id` order so that two transactions locking overlapping sets cannot deadlock. A concurrent
 * conditional `updateMany` on one of these rows waits for `tx`, then re-checks its `where`
 * against the committed row (spec SP1.6 F7).
 */
export async function lockMemberships(tx: TenantTx, wid: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "membership"
      WHERE workspace_id = ${wid}::uuid AND user_id = ANY(${userIds}::uuid[])
      ORDER BY id FOR UPDATE`,
  );
}

/**
 * The stored settings, validated. Rows always hold a full v1 object; should one not parse (a
 * key added by hand, a future migration gap), the defaults on the workspace time zone are
 * overlaid with the stored keys and, failing that too, the defaults alone are served.
 */
export function readSettings(
  w: Pick<Workspace, 'settings' | 'defaultTimezone'>,
): WorkspaceSettings {
  const parsed = WorkspaceSettingsSchema.safeParse(w.settings);
  if (parsed.success) return parsed.data;
  const defaults = defaultWorkspaceSettings(w.defaultTimezone);
  const stored =
    typeof w.settings === 'object' && w.settings !== null && !Array.isArray(w.settings)
      ? (w.settings as Record<string, unknown>)
      : {};
  const merged = WorkspaceSettingsSchema.safeParse({ ...defaults, ...stored, v: 1 });
  return merged.success ? merged.data : defaults;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `Workspace.settings` (PRD §8.2.1): read by any member, changed under `workspace.settings.update`. */
@Injectable()
export class WorkspaceSettingsService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace'>,
    private readonly audit: AuditService,
  ) {}

  async get(wid: string): Promise<WorkspaceSettings> {
    const w = await this.db.workspace.findUniqueOrThrow({
      where: { id: wid },
      select: { settings: true, defaultTimezone: true },
    });
    return readSettings(w);
  }

  /**
   * Merges `patch` (each key already range-checked) into the stored settings and validates the
   * result against the full `WorkspaceSettingsSchema` (`422 VALIDATION_FAILED` with
   * `details.issues`, e.g. `partial_ratio ≥ present_ratio`). A new `default_timezone` is copied
   * to `Workspace.defaultTimezone`. Audits `workspace.settings_updated` with before/after of the
   * keys that changed (none → no write, no audit).
   */
  async update(wid: string, patch: WorkspaceSettingsPatch): Promise<WorkspaceSettings> {
    const { settings, before, after } = await withTenantTx(wid, async (tx) => {
      await lockWorkspace(tx, wid);
      const current = readSettings(
        await tx.workspace.findUniqueOrThrow({
          where: { id: wid },
          select: { settings: true, defaultTimezone: true },
        }),
      );
      const result = WorkspaceSettingsSchema.safeParse({ ...current, ...patch });
      if (!result.success) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Validation failed',
          {
            issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
          },
        );
      }
      const next = result.data;
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of Object.keys(next) as (keyof WorkspaceSettings)[]) {
        if (sameValue(current[key], next[key])) continue;
        before[key] = current[key];
        after[key] = next[key];
      }
      if (Object.keys(after).length === 0) return { settings: current, before, after };
      await tx.workspace.update({
        where: { id: wid },
        data: {
          settings: { ...next },
          ...(after.default_timezone !== undefined && { defaultTimezone: next.default_timezone }),
        },
      });
      return { settings: next, before, after };
    });
    if (Object.keys(after).length > 0) {
      await this.audit.log({
        action: 'workspace.settings_updated',
        entityType: 'Workspace',
        entityId: wid,
        before,
        after,
      });
    }
    return settings;
  }
}
