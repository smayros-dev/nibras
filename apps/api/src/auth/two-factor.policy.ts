import { crossTenantDb, type User } from '@tt/db';

/**
 * PRD D-P12 / §8.1.2: 2FA is mandatory for a `SUPER_ADMIN` and for an ACTIVE `OWNER`/`ADMIN` of
 * an `ORGANIZATION` workspace (in any status: a suspended organisation still holds pupils' data);
 * optional for everyone else. Read through `crossTenantDb()` (a `/me`-style read across the
 * user's own memberships, filtered on `userId`).
 */
export async function requiresTwoFactor(user: Pick<User, 'id' | 'platformRole'>): Promise<boolean> {
  if (user.platformRole === 'SUPER_ADMIN') return true;
  const membership = await crossTenantDb().membership.findFirst({
    where: {
      userId: user.id,
      status: 'ACTIVE',
      role: { in: ['OWNER', 'ADMIN'] },
      workspace: { type: 'ORGANIZATION' },
    },
    select: { id: true },
  });
  return membership !== null;
}
