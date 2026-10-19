import type { PrismaClient } from '@nibras/db';
import { expect } from 'vitest';

/**
 * The ownership invariant (spec SP1.6 F7): exactly one `OWNER` membership in `wid`, `ACTIVE`,
 * and `workspace.ownerUserId` is its user. Returns the owner's user id.
 */
export async function expectOneOwner(db: PrismaClient, wid: string): Promise<string> {
  const owners = await db.membership.findMany({
    where: { workspaceId: wid, role: 'OWNER' },
    select: { userId: true, status: true },
  });
  expect(owners, `workspace ${wid} must have exactly one OWNER membership`).toHaveLength(1);
  const [owner] = owners;
  expect(owner!.status, `the OWNER of ${wid} must be ACTIVE`).toBe('ACTIVE');
  const { ownerUserId } = await db.workspace.findUniqueOrThrow({
    where: { id: wid },
    select: { ownerUserId: true },
  });
  expect(ownerUserId, `workspace ${wid}: ownerUserId must be the OWNER membership's user`).toBe(
    owner!.userId,
  );
  return owner!.userId;
}
