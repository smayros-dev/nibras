import type { PrismaClient, User, Workspace } from '@nibras/db';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createUser } from '../helpers/factories';
import { expectOneOwner } from '../helpers/invariants';

/** Base32 TOTP seed: organisation OWNER/ADMIN clear the 2FA gate with it. */
const S = 'JBSWY3DPEHPK3PXP';
/** Each race runs this many times on a fresh organisation (vitest has no repeat flag). */
const ITERATIONS = 10;

const ws = (wid: string, path = '') => `/api/v1/workspaces/${wid}${path}`;

describe('ownership invariant under concurrency (spec SP1.6 F7)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let db: PrismaClient;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ http, db } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const agent = async (user: User) => as(http, (await loginAs(ctx, user)).cookie);

  /** An organisation with an OWNER and `admins` ACTIVE ADMINs (all with 2FA). */
  async function org(admins = 1) {
    const owner = await createUser({ totpSecret: S });
    const others = await Promise.all(
      Array.from({ length: admins }, () => createUser({ totpSecret: S })),
    );
    const { workspace } = await createOrganization({ owner, admins: others });
    return { owner, admins: others, workspace };
  }

  /** Starts a supertest request now (supertest is lazy until `then`). */
  const start = (req: PromiseLike<Response>): Promise<Response> =>
    new Promise((resolve, reject) => req.then(resolve, reject));

  it('transfer ∥ remove(target): one wins, never a removed OWNER', async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const { owner, admins, workspace } = await org();
      const admin = admins[0]!;
      const o = await agent(owner);
      const [t, r] = await Promise.all([
        start(o.post(ws(workspace.id, '/transfer-ownership')).send({ toUserId: admin.id })),
        start(o.delete(ws(workspace.id, `/members/${admin.id}`))),
      ]);
      const outcome = `transfer ${t.status} / remove ${r.status}`;
      if (t.status === 204) {
        // The removal read the target before or after the promotion: 404 (role guard) or 409.
        expect([404, 409], outcome).toContain(r.status);
        expect(await expectOneOwner(db, workspace.id)).toBe(admin.id);
      } else {
        expect(r.status, outcome).toBe(204);
        expect(t.status, outcome).toBe(422);
        expect(await expectOneOwner(db, workspace.id)).toBe(owner.id);
      }
    }
  });

  it('transfer ∥ demote(target → TEACHER): the OWNER is never a TEACHER', async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const { owner, admins, workspace } = await org();
      const admin = admins[0]!;
      const o = await agent(owner);
      const [t, d] = await Promise.all([
        start(o.post(ws(workspace.id, '/transfer-ownership')).send({ toUserId: admin.id })),
        start(o.patch(ws(workspace.id, `/members/${admin.id}`)).send({ role: 'TEACHER' })),
      ]);
      const outcome = `transfer ${t.status} / demote ${d.status}`;
      if (t.status === 204) {
        // 404: read ADMIN, the role guard matched nothing; 422: read OWNER.
        expect([404, 422], outcome).toContain(d.status);
        expect(await expectOneOwner(db, workspace.id)).toBe(admin.id);
      } else {
        expect(d.status, outcome).toBe(200);
        expect(t.status, outcome).toBe(422);
        expect(await expectOneOwner(db, workspace.id)).toBe(owner.id);
        const demoted = await db.membership.findFirstOrThrow({
          where: { workspaceId: workspace.id, userId: admin.id },
        });
        expect(demoted.role).toBe('TEACHER');
      }
    }
  });

  it('transfer(A→B) ∥ transfer(A→C): exactly one 204, the other 403; ownerUserId matches', async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const { owner, admins, workspace } = await org(2);
      const b = admins[0]!;
      const c = admins[1]!;
      const o = await agent(owner);
      const [tb, tc] = await Promise.all([
        start(o.post(ws(workspace.id, '/transfer-ownership')).send({ toUserId: b.id })),
        start(o.post(ws(workspace.id, '/transfer-ownership')).send({ toUserId: c.id })),
      ]);
      expect([tb.status, tc.status].sort(), `A→B ${tb.status} / A→C ${tc.status}`).toEqual([
        204, 403,
      ]);
      const loser = tb.status === 403 ? tb : tc;
      expect(loser.body.code).toBe('PERMISSION_DENIED');
      const newOwner = await expectOneOwner(db, workspace.id);
      expect(newOwner).toBe(tb.status === 204 ? b.id : c.id);
      const roles = await db.membership.findMany({
        where: { workspaceId: workspace.id },
        select: { userId: true, role: true },
      });
      expect(roles.filter((m) => m.role === 'ADMIN')).toHaveLength(2);
    }
  });

  it('transfer then immediate transfer-back by the new owner: both 204, invariant holds', async () => {
    const { owner, admins, workspace } = await org();
    const admin = admins[0]!;
    const o = await agent(owner);
    const a = await agent(admin);
    for (let i = 0; i < ITERATIONS; i++) {
      await o
        .post(ws(workspace.id, '/transfer-ownership'))
        .send({ toUserId: admin.id })
        .expect(204);
      await a
        .post(ws(workspace.id, '/transfer-ownership'))
        .send({ toUserId: owner.id })
        .expect(204);
      expect(await expectOneOwner(db, workspace.id)).toBe(owner.id);
    }
    // Concurrently: the transfer-back either runs after the transfer (both 204) or before it
    // (the admin is not the owner yet: 403).
    for (let i = 0; i < ITERATIONS; i++) {
      const before = await expectOneOwner(db, workspace.id);
      const [from, to] = before === owner.id ? [o, a] : [a, o];
      const [fromUser, toUser] = before === owner.id ? [owner, admin] : [admin, owner];
      const [t, back] = await Promise.all([
        start(from.post(ws(workspace.id, '/transfer-ownership')).send({ toUserId: toUser.id })),
        start(to.post(ws(workspace.id, '/transfer-ownership')).send({ toUserId: fromUser.id })),
      ]);
      expect(t.status).toBe(204);
      expect([204, 403], `transfer-back ${back.status}`).toContain(back.status);
      expect(await expectOneOwner(db, workspace.id)).toBe(
        back.status === 204 ? fromUser.id : toUser.id,
      );
    }
  });

  describe('members.update/remove refuse a membership that became OWNER meanwhile (role guard)', () => {
    /**
     * Holds a row lock on the target's membership, starts `request`, waits until the request is
     * blocked on that lock (it read the row as ADMIN before), then makes the target OWNER and
     * commits. The request then re-evaluates its conditional update against the new row.
     */
    async function promoteWhileBlocked(
      workspace: Workspace,
      owner: User,
      target: User,
      request: () => PromiseLike<Response>,
    ): Promise<Response> {
      let pending: Promise<Response> | undefined;
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT 1 FROM "membership"
            WHERE workspace_id = ${workspace.id}::uuid AND user_id = ${target.id}::uuid
            FOR UPDATE`;
          pending = start(request());
          await waitForBlockedQuery(db);
          await tx.membership.update({
            where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } },
            data: { role: 'ADMIN' },
          });
          await tx.membership.update({
            where: { workspaceId_userId: { workspaceId: workspace.id, userId: target.id } },
            data: { role: 'OWNER' },
          });
          await tx.workspace.update({
            where: { id: workspace.id },
            data: { ownerUserId: target.id },
          });
        },
        { timeout: 20_000 },
      );
      return pending!;
    }

    it('DELETE /members/{uid} → 404, the new OWNER stays ACTIVE', async () => {
      const { owner, admins, workspace } = await org();
      const admin = admins[0]!;
      const o = await agent(owner);
      const res = await promoteWhileBlocked(workspace, owner, admin, () =>
        o.delete(ws(workspace.id, `/members/${admin.id}`)),
      );
      expect(res.status).toBe(404);
      expect(await expectOneOwner(db, workspace.id)).toBe(admin.id);
      expect(
        await db.auditLog.count({ where: { action: 'member.removed', workspaceId: workspace.id } }),
      ).toBe(0);
    });

    it('PATCH /members/{uid} → 404, the new OWNER keeps its role', async () => {
      const { owner, admins, workspace } = await org();
      const admin = admins[0]!;
      const o = await agent(owner);
      const res = await promoteWhileBlocked(workspace, owner, admin, () =>
        o.patch(ws(workspace.id, `/members/${admin.id}`)).send({ role: 'TEACHER' }),
      );
      expect(res.status).toBe(404);
      expect(await expectOneOwner(db, workspace.id)).toBe(admin.id);
      expect(
        await db.auditLog.count({
          where: { action: 'member.role_changed', workspaceId: workspace.id },
        }),
      ).toBe(0);
    });
  });
});

/**
 * Resolves once another session of this database waits for a lock (`pg_locks.granted = false`;
 * `pg_locks` and the `pid`/`datname` columns of `pg_stat_activity` are readable by any role).
 */
async function waitForBlockedQuery(db: PrismaClient, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_locks
      WHERE NOT granted
        AND pid IN (SELECT pid FROM pg_stat_activity WHERE datname = current_database())`;
    if (row && row.waiting > 0n) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('no query blocked on the held row lock');
}
