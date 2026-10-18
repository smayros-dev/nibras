import { Inject, Injectable } from '@nestjs/common';
import type { MeUser, MyWorkspace, UpdateMeInput } from '@nibras/contracts';
import { crossTenantDb, type GuardedClient, type User } from '@nibras/db';
import { AuditService } from '../audit/audit.service';
import { toMeUser } from '../auth/me-user';
import { requiresTwoFactor } from '../auth/two-factor.policy';
import { DB } from '../db/db.module';
import { ConsentService } from './consent.service';

type ProfileKey = keyof UpdateMeInput;
const PROFILE_KEYS: readonly ProfileKey[] = [
  'firstName',
  'lastName',
  'locale',
  'timezone',
  'birthDate',
];

/** A profile field as the API shows it (`birthDate` as `YYYY-MM-DD`). */
function profileValue(user: User, key: ProfileKey): string | null {
  if (key === 'birthDate') return user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null;
  return user[key];
}

/** Profile of the signed-in user and their cross-workspace aggregates (`/me`). */
@Injectable()
export class MeService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user'>,
    private readonly consents: ConsentService,
    private readonly audit: AuditService,
  ) {}

  /** `MeUser` with the computed `twoFactor.required` and `pendingConsents`. */
  async me(userId: string): Promise<MeUser> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    return this.serialise(user);
  }

  /**
   * Updates the given profile keys (already validated by `UpdateMeSchema`); audits
   * `user.profile_updated` with before/after of the keys whose value actually changed (none
   * changed → no write, no audit).
   */
  async update(userId: string, input: UpdateMeInput): Promise<MeUser> {
    const current = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    for (const key of PROFILE_KEYS) {
      const next = input[key];
      if (next === undefined || next === profileValue(current, key)) continue;
      before[key] = profileValue(current, key);
      after[key] = next;
    }
    if (Object.keys(after).length === 0) return this.serialise(current);

    const { birthDate, ...rest } = after;
    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        ...rest,
        ...(birthDate !== undefined && {
          birthDate: birthDate === null ? null : new Date(`${birthDate}T00:00:00.000Z`),
        }),
      },
    });
    await this.audit.log({
      action: 'user.profile_updated',
      entityType: 'User',
      entityId: userId,
      before,
      after,
    });
    return this.serialise(updated);
  }

  /**
   * Every membership of the user that is not over (REMOVED / REJECTED), across workspaces, by
   * workspace name. Read through `crossTenantDb()` with a top-level `userId` filter: only the
   * caller's own rows (Review Focus 1).
   */
  async workspaces(userId: string): Promise<MyWorkspace[]> {
    const rows = await crossTenantDb().membership.findMany({
      where: { userId, status: { notIn: ['REMOVED', 'REJECTED'] } },
      select: {
        role: true,
        canTeach: true,
        status: true,
        workspace: { select: { id: true, name: true, slug: true, type: true, status: true } },
      },
      orderBy: [{ workspace: { name: 'asc' } }, { workspaceId: 'asc' }],
    });
    return rows.map((m) => ({
      workspace: m.workspace,
      role: m.role,
      canTeach: m.canTeach,
      status: m.status as MyWorkspace['status'],
    }));
  }

  private async serialise(user: User): Promise<MeUser> {
    const [twoFactorRequired, pendingConsents] = await Promise.all([
      requiresTwoFactor(user),
      this.consents.pending(user.id),
    ]);
    return toMeUser(user, { twoFactorRequired, pendingConsents });
  }
}
