import { randomUUID } from 'node:crypto';
import { WorkspaceSettingsSchema } from '@tt/contracts';
import type { PrismaClient } from '@tt/db';
import type { InMemoryEmailProvider } from '@tt/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createPersonalWorkspace, createUser } from '../helpers/factories';

/** Base32 TOTP seed: organisation OWNER/ADMIN clear the 2FA gate with it. */
const S = 'JBSWY3DPEHPK3PXP';
const GIB = 1024n ** 3n;

describe('workspaces: creation, D-O7 personal rule, details, delete, transfer, audit log', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let db: PrismaClient;
  let email: InMemoryEmailProvider;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ http, db, email } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const ws = (wid: string, path = '') => `/api/v1/workspaces/${wid}${path}`;

  it('creates an organisation with owner membership, 200 GiB quota, defaults and audit', async () => {
    const u = await createUser({ totpSecret: S });
    const s = await loginAs(ctx, u);
    const res = await as(http, s.cookie)
      .post('/api/v1/workspaces')
      .send({ name: 'Académie Nour', country: 'MA', timezone: 'Africa/Casablanca' })
      .expect(201);
    expect(res.body).toMatchObject({
      type: 'ORGANIZATION',
      name: 'Académie Nour',
      slug: expect.stringMatching(/^academie-nour-[a-z2-7]{6}$/),
      status: 'ACTIVE',
      country: 'MA',
      defaultTimezone: 'Africa/Casablanca',
      defaultLocale: 'fr',
      allowPersonalWorkspaces: true,
      myRole: 'OWNER',
      myCanTeach: false,
    });
    const w = await db.workspace.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { memberships: true },
    });
    expect(w.storageQuotaBytes).toBe(200n * GIB);
    expect(w.ownerUserId).toBe(u.id);
    expect(w.memberships).toHaveLength(1);
    expect(w.memberships[0]).toMatchObject({ userId: u.id, role: 'OWNER', status: 'ACTIVE' });
    expect(WorkspaceSettingsSchema.parse(w.settings)).toMatchObject({
      default_timezone: 'Africa/Casablanca',
      present_ratio: 0.75,
      default_reminder_offsets_min: [1440, 15, 0],
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'workspace.created', workspaceId: w.id },
    });
    expect(audit).toMatchObject({ actorUserId: u.id, entityType: 'Workspace', entityId: w.id });
    expect(audit.after).toMatchObject({ type: 'ORGANIZATION', name: 'Académie Nour' });

    // The creator reaches it as OWNER right away.
    await as(http, s.cookie)
      .get(ws(w.id))
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: w.id, myRole: 'OWNER' }));
  });

  it('POST /workspaces validates its input and needs a signed-in, email-verified user', async () => {
    const u = await createUser({ totpSecret: S });
    const s = await loginAs(ctx, u);
    for (const body of [
      { name: 'X', country: 'MA' },
      { name: '   ', timezone: 'Africa/Tunis' },
      { name: 'X', timezone: 'Mars/Olympus' },
      { name: 'X', timezone: 'Africa/Tunis', country: 'MAR' },
      { name: 'X', timezone: 'Africa/Tunis', type: 'PERSONAL' },
    ]) {
      await as(http, s.cookie)
        .post('/api/v1/workspaces')
        .send(body)
        .expect(422)
        .expect(({ body: b }) => expect(b.code).toBe('VALIDATION_FAILED'));
    }
    await http.post('/api/v1/workspaces').send({ name: 'X', timezone: 'Africa/Tunis' }).expect(401);
    const unverified = await createUser({ emailVerified: false });
    await as(http, (await loginAs(ctx, unverified)).cookie)
      .post('/api/v1/workspaces')
      .send({ name: 'X', timezone: 'Africa/Tunis' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_NOT_VERIFIED'));
    expect(await db.workspace.count()).toBe(0);
  });

  it('AC-WS-08: invited teacher has no PERSONAL workspace; creation allowed unless an organisation forbids it; self-signup teacher always has one', async () => {
    const teacher = await createUser({ firstName: 'Amina' });
    await createOrganization({
      owner: await createUser({ totpSecret: S }),
      teachers: [teacher],
      name: 'Org A',
    });
    const orgB = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      teachers: [teacher],
      allowPersonalWorkspaces: false,
      name: 'Org B',
    });
    const s = await loginAs(ctx, teacher);
    const mine = await as(http, s.cookie).get('/api/v1/me/workspaces').expect(200);
    expect(mine.body.map((m: { workspace: { type: string } }) => m.workspace.type)).toEqual([
      'ORGANIZATION',
      'ORGANIZATION',
    ]);

    const forbidden = await as(http, s.cookie).post('/api/v1/me/personal-workspace').expect(403);
    expect(forbidden.body.code).toBe('PERSONAL_WORKSPACE_FORBIDDEN');
    expect(forbidden.body.details).toEqual({
      organizationId: orgB.workspace.id,
      organizationName: orgB.workspace.name,
    });
    expect(await db.workspace.count({ where: { type: 'PERSONAL' } })).toBe(0);

    await db.workspace.update({
      where: { id: orgB.workspace.id },
      data: { allowPersonalWorkspaces: true },
    });
    const created = await as(http, s.cookie).post('/api/v1/me/personal-workspace').expect(201);
    expect(created.body).toMatchObject({
      type: 'PERSONAL',
      name: 'Espace de Amina',
      slug: expect.stringMatching(/^espace-de-amina-[a-z2-7]{6}$/),
      myRole: 'OWNER',
    });
    const personal = await db.workspace.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { memberships: true },
    });
    expect(personal.storageQuotaBytes).toBe(20n * GIB);
    expect(personal.memberships).toMatchObject([
      { userId: teacher.id, role: 'OWNER', status: 'ACTIVE' },
    ]);
    expect(
      await db.auditLog.count({ where: { action: 'workspace.created', workspaceId: personal.id } }),
    ).toBe(1);

    await as(http, s.cookie)
      .post('/api/v1/me/personal-workspace')
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PERSONAL_WORKSPACE_EXISTS'));

    // Self-signup: registration creates the PERSONAL workspace.
    await http
      .post('/api/v1/auth/register')
      .send({
        kind: 'TEACHER',
        firstName: 'Karim',
        lastName: 'Ben Ali',
        email: 'karim@example.com',
        password: 'un mot de passe assez long',
        locale: 'ar',
        timezone: 'Africa/Tunis',
        acceptTerms: true,
        acceptPrivacy: true,
      })
      .expect(201);
    const karim = await db.user.update({
      where: { email: 'karim@example.com' },
      data: { emailVerifiedAt: new Date() },
    });
    const karimWs = await as(http, (await loginAs(ctx, karim)).cookie)
      .get('/api/v1/me/workspaces')
      .expect(200);
    expect(karimWs.body).toMatchObject([
      { workspace: { type: 'PERSONAL', name: 'Espace de Karim' }, role: 'OWNER' },
    ]);
  });

  it('D-O7: an organisation OWNER, a STUDENT or a non-ACTIVE teacher is not blocked by allowPersonalWorkspaces = false', async () => {
    const orgOwner = await createUser({ totpSecret: S });
    const leftTeacher = await createUser();
    await createOrganization({
      owner: orgOwner,
      allowPersonalWorkspaces: false,
      members: [{ user: leftTeacher, role: 'TEACHER', status: 'REMOVED' }],
    });
    await as(http, (await loginAs(ctx, orgOwner)).cookie)
      .post('/api/v1/me/personal-workspace')
      .expect(201);
    await as(http, (await loginAs(ctx, leftTeacher)).cookie)
      .post('/api/v1/me/personal-workspace')
      .expect(201);
  });

  it('a DELETING personal workspace still counts: delete then POST /me/personal-workspace → 409', async () => {
    const owner = await createUser();
    const s = await loginAs(ctx, owner);
    const created = await as(http, s.cookie).post('/api/v1/me/personal-workspace').expect(201);
    await as(http, s.cookie).delete(ws(created.body.id)).expect(204);
    await as(http, s.cookie)
      .post('/api/v1/me/personal-workspace')
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PERSONAL_WORKSPACE_EXISTS'));
    expect(await db.workspace.count({ where: { ownerUserId: owner.id, type: 'PERSONAL' } })).toBe(
      1,
    );
  });

  it('GET /workspaces/{wid} returns the workspace and the caller role to any active member', async () => {
    const owner = await createUser({ totpSecret: S });
    const student = await createUser();
    const teachingAdmin = await createUser({ totpSecret: S });
    const { workspace } = await createOrganization({
      owner,
      students: [student],
      members: [{ user: teachingAdmin, role: 'ADMIN', canTeach: true }],
      name: 'École Ibn Khaldoun',
    });
    const { body } = await as(http, (await loginAs(ctx, student)).cookie)
      .get(ws(workspace.id))
      .expect(200);
    expect(body).toEqual({
      id: workspace.id,
      name: 'École Ibn Khaldoun',
      slug: workspace.slug,
      type: 'ORGANIZATION',
      status: 'ACTIVE',
      country: null,
      defaultTimezone: 'Africa/Tunis',
      defaultLocale: 'fr',
      allowPersonalWorkspaces: true,
      createdAt: workspace.createdAt.toISOString(),
      myRole: 'STUDENT',
      myCanTeach: false,
    });
    await as(http, (await loginAs(ctx, teachingAdmin)).cookie)
      .get(ws(workspace.id))
      .expect(200)
      .expect(({ body: b }) => expect(b).toMatchObject({ myRole: 'ADMIN', myCanTeach: true }));
    // A stranger: 404.
    await as(http, (await loginAs(ctx, await createUser())).cookie)
      .get(ws(workspace.id))
      .expect(404);
  });

  it('PATCH /workspaces/{wid} updates and audits; allowPersonalWorkspaces is ORGANIZATION-only', async () => {
    const owner = await createUser({ totpSecret: S });
    const { workspace } = await createOrganization({ owner, name: 'Old name' });
    const s = await loginAs(ctx, owner);
    const { body } = await as(http, s.cookie)
      .patch(ws(workspace.id))
      .send({
        name: 'New name',
        country: 'tn',
        defaultLocale: 'ar',
        allowPersonalWorkspaces: false,
      })
      .expect(200);
    expect(body).toMatchObject({
      name: 'New name',
      country: 'TN',
      defaultLocale: 'ar',
      allowPersonalWorkspaces: false,
      slug: workspace.slug,
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'workspace.updated', workspaceId: workspace.id },
    });
    expect(audit).toMatchObject({
      actorUserId: owner.id,
      actorRole: 'OWNER',
      before: {
        name: 'Old name',
        country: null,
        defaultLocale: 'fr',
        allowPersonalWorkspaces: true,
      },
      after: {
        name: 'New name',
        country: 'TN',
        defaultLocale: 'ar',
        allowPersonalWorkspaces: false,
      },
    });

    // The column and the settings key stay in sync.
    await as(http, s.cookie)
      .patch(ws(workspace.id))
      .send({ defaultTimezone: 'Europe/Paris' })
      .expect(200);
    const w = await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(w.defaultTimezone).toBe('Europe/Paris');
    expect(WorkspaceSettingsSchema.parse(w.settings).default_timezone).toBe('Europe/Paris');

    for (const bad of [
      { name: '' },
      { defaultLocale: 'de' },
      { slug: 'x' },
      { status: 'ACTIVE' },
    ]) {
      await as(http, s.cookie).patch(ws(workspace.id)).send(bad).expect(422);
    }

    const teacher = await createUser();
    const personal = await createPersonalWorkspace(teacher);
    const ts = await loginAs(ctx, teacher);
    await as(http, ts.cookie)
      .patch(ws(personal.id))
      .send({ allowPersonalWorkspaces: false })
      .expect(422)
      .expect(({ body: b }) => expect(b.code).toBe('VALIDATION_FAILED'));
    // A personal owner renames his workspace (§8.2.1 « renommable »).
    await as(http, ts.cookie)
      .patch(ws(personal.id))
      .send({ name: 'Cours de maths' })
      .expect(200)
      .expect(({ body: b }) => expect(b.name).toBe('Cours de maths'));
  });

  it('GET /workspaces/{wid}/storage returns quota and usage as strings', async () => {
    const owner = await createUser();
    const personal = await createPersonalWorkspace(owner);
    await db.workspace.update({
      where: { id: personal.id },
      data: { storageUsedBytes: 9_007_199_254_740_993n },
    });
    await as(http, (await loginAs(ctx, owner)).cookie)
      .get(ws(personal.id, '/storage'))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          quotaBytes: (20n * GIB).toString(),
          usedBytes: '9007199254740993',
        }),
      );
  });

  it('AC-WS-04: owner transfers to an admin; roles swap, audit row and both emails', async () => {
    const owner = await createUser({ totpSecret: S, firstName: 'Omar' });
    const admin = await createUser({ totpSecret: S, firstName: 'Sana', locale: 'ar' });
    const { workspace } = await createOrganization({
      owner,
      admins: [admin],
      name: 'Académie Nour',
    });
    await db.membership.update({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } },
      data: { canTeach: true },
    });
    await as(http, (await loginAs(ctx, owner)).cookie)
      .post(ws(workspace.id, '/transfer-ownership'))
      .send({ toUserId: admin.id })
      .expect(204);

    const memberships = await db.membership.findMany({ where: { workspaceId: workspace.id } });
    const roles = Object.fromEntries(memberships.map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [owner.id]: 'ADMIN', [admin.id]: 'OWNER' });
    // The former owner keeps can_teach.
    expect(memberships.find((m) => m.userId === owner.id)!.canTeach).toBe(true);
    expect(
      (await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).ownerUserId,
    ).toBe(admin.id);
    expect(
      await db.auditLog.findFirst({
        where: { action: 'workspace.ownership_transferred', workspaceId: workspace.id },
      }),
    ).toMatchObject({
      actorUserId: owner.id,
      actorRole: 'OWNER',
      before: { ownerUserId: owner.id },
      after: { ownerUserId: admin.id },
    });
    const [toOwner] = email.findByTemplate('workspace.ownership_transferred', owner.email);
    const [toAdmin] = email.findByTemplate('workspace.ownership_transferred', admin.email);
    expect(toOwner).toMatchObject({
      locale: 'fr',
      params: { firstName: 'Omar', workspaceName: 'Académie Nour' },
    });
    expect(toAdmin).toMatchObject({
      locale: 'ar',
      params: { firstName: 'Sana', workspaceName: 'Académie Nour' },
    });

    // The new owner can transfer back; the former one no longer can.
    await as(http, (await loginAs(ctx, owner)).cookie)
      .post(ws(workspace.id, '/transfer-ownership'))
      .send({ toUserId: admin.id })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
  });

  it('transfer-ownership: the target must be an ACTIVE ADMIN; PERSONAL → 409 NOT_AN_ORGANIZATION', async () => {
    const owner = await createUser({ totpSecret: S });
    const teacher = await createUser();
    const removedAdmin = await createUser({ totpSecret: S });
    const stranger = await createUser();
    const { workspace } = await createOrganization({
      owner,
      teachers: [teacher],
      members: [{ user: removedAdmin, role: 'ADMIN', status: 'REMOVED' }],
    });
    const s = await loginAs(ctx, owner);
    for (const toUserId of [teacher.id, removedAdmin.id, stranger.id, owner.id, randomUUID()]) {
      await as(http, s.cookie)
        .post(ws(workspace.id, '/transfer-ownership'))
        .send({ toUserId })
        .expect(422)
        .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    }
    await as(http, s.cookie)
      .post(ws(workspace.id, '/transfer-ownership'))
      .send({ toUserId: 'nope' })
      .expect(422);
    expect(
      await db.membership.findFirst({ where: { workspaceId: workspace.id, role: 'OWNER' } }),
    ).toMatchObject({ userId: owner.id });

    const personalOwner = await createUser();
    const personal = await createPersonalWorkspace(personalOwner);
    await as(http, (await loginAs(ctx, personalOwner)).cookie)
      .post(ws(personal.id, '/transfer-ownership'))
      .send({ toUserId: stranger.id })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('NOT_AN_ORGANIZATION'));
    expect(email.findByTemplate('workspace.ownership_transferred')).toHaveLength(0);
  });

  it('an ADMIN cannot transfer or delete (403), a TEACHER cannot change settings (403), a personal owner can', async () => {
    const owner = await createUser({ totpSecret: S });
    const admin = await createUser({ totpSecret: S });
    const teacher = await createUser();
    const { workspace } = await createOrganization({
      owner,
      admins: [admin],
      teachers: [teacher],
    });
    const as403 = (req: ReturnType<TestAgent['get']>) =>
      req.expect(403).expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));

    const a = await loginAs(ctx, admin);
    await as403(
      as(http, a.cookie).post(ws(workspace.id, '/transfer-ownership')).send({ toUserId: admin.id }),
    );
    await as403(as(http, a.cookie).delete(ws(workspace.id)));
    // An ADMIN may change settings (§7 ✅).
    await as(http, a.cookie).patch(ws(workspace.id)).send({ name: 'By admin' }).expect(200);

    const t = await loginAs(ctx, teacher);
    await as403(as(http, t.cookie).patch(ws(workspace.id)).send({ name: 'By teacher' }));
    await as403(
      as(http, t.cookie).patch(ws(workspace.id, '/settings')).send({ late_threshold_min: 5 }),
    );
    await as403(as(http, t.cookie).get(ws(workspace.id, '/storage')));
    await as403(as(http, t.cookie).get(ws(workspace.id, '/audit-log')));
    await as403(as(http, t.cookie).delete(ws(workspace.id)));

    const personalOwner = await createUser();
    const personal = await createPersonalWorkspace(personalOwner);
    const p = await loginAs(ctx, personalOwner);
    await as(http, p.cookie).patch(ws(personal.id)).send({ name: 'Mon espace' }).expect(200);
    await as(http, p.cookie)
      .patch(ws(personal.id, '/settings'))
      .send({ late_threshold_min: 5 })
      .expect(200);
    await as(http, p.cookie).get(ws(personal.id, '/audit-log')).expect(200);
    await as(http, p.cookie).delete(ws(personal.id)).expect(204);
  });

  it('DELETE marks DELETING; subsequent mutations are 423', async () => {
    const owner = await createUser({ totpSecret: S });
    const { workspace } = await createOrganization({ owner });
    const s = await loginAs(ctx, owner);
    await as(http, s.cookie).delete(ws(workspace.id)).expect(204);

    const w = await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(w.status).toBe('DELETING');
    expect(w.deletedAt).toBeInstanceOf(Date);
    expect(Date.now() - w.deletedAt!.getTime()).toBeLessThan(60_000);
    expect(
      await db.auditLog.findFirst({ where: { action: 'workspace.deleted', workspaceId: w.id } }),
    ).toMatchObject({
      actorUserId: owner.id,
      actorRole: 'OWNER',
      before: { status: 'ACTIVE' },
      after: { status: 'DELETING' },
    });

    // Reads stay possible; every mutation is 423.
    await as(http, s.cookie)
      .get(ws(workspace.id))
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('DELETING'));
    for (const req of [
      as(http, s.cookie).patch(ws(workspace.id)).send({ name: 'x' }),
      as(http, s.cookie).patch(ws(workspace.id, '/settings')).send({ late_threshold_min: 5 }),
      as(http, s.cookie).delete(ws(workspace.id)),
      as(http, s.cookie).post(ws(workspace.id, '/transfer-ownership')).send({ toUserId: owner.id }),
    ]) {
      await req.expect(423).expect(({ body }) => expect(body.code).toBe('WORKSPACE_SUSPENDED'));
    }
  });

  it('audit-log endpoint is paginated newest-first and filterable by action; TEACHER in org gets 403', async () => {
    const owner = await createUser({ totpSecret: S });
    const teacher = await createUser();
    const { workspace } = await createOrganization({ owner, teachers: [teacher] });
    const other = await createOrganization({ owner: await createUser({ totpSecret: S }) });
    const t0 = new Date('2026-10-01T10:00:00.000Z');
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
    const row = (wid: string, action: string, createdAt: Date, actorUserId = owner.id) => ({
      workspaceId: wid,
      actorUserId,
      actorRole: 'OWNER',
      action,
      entityType: 'Workspace',
      entityId: wid,
      requestId: randomUUID(),
      createdAt,
    });
    // Three rows share one timestamp: the id breaks the tie, so no row is skipped or repeated.
    await db.auditLog.createMany({
      data: [
        row(workspace.id, 'workspace.updated', at(1)),
        row(workspace.id, 'workspace.settings_updated', at(2)),
        row(workspace.id, 'workspace.updated', at(3)),
        row(workspace.id, 'workspace.updated', at(3)),
        row(workspace.id, 'workspace.updated', at(3), teacher.id),
        row(workspace.id, 'workspace.settings_updated', at(4)),
        row(other.workspace.id, 'workspace.updated', at(5)),
        row(other.workspace.id, 'workspace.updated', at(0)),
      ],
    });
    const expected = await db.auditLog.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(expected).toHaveLength(6);

    const s = await loginAs(ctx, owner);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const { body } = await as(http, s.cookie)
        .get(`${ws(workspace.id, '/audit-log')}?${query}&workspaceId=${other.workspace.id}`)
        .expect(200);
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(...body.items.map((i: { id: string }) => i.id));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen).toEqual(expected.map((e) => e.id));

    const first = (await as(http, s.cookie).get(ws(workspace.id, '/audit-log')).expect(200)).body;
    expect(first.nextCursor).toBeNull();
    expect(first.items[0]).toEqual({
      id: expected[0]!.id,
      action: 'workspace.settings_updated',
      entityType: 'Workspace',
      entityId: workspace.id,
      actorUserId: owner.id,
      actorRole: 'OWNER',
      before: null,
      after: null,
      ip: null,
      userAgent: null,
      requestId: expected[0]!.requestId,
      createdAt: at(4).toISOString(),
    });

    const filtered = await as(http, s.cookie)
      .get(`${ws(workspace.id, '/audit-log')}?action=workspace.settings_updated`)
      .expect(200);
    expect(filtered.body.items.map((i: { createdAt: string }) => i.createdAt)).toEqual([
      at(4).toISOString(),
      at(2).toISOString(),
    ]);
    const byActor = await as(http, s.cookie)
      .get(`${ws(workspace.id, '/audit-log')}?actorUserId=${teacher.id}`)
      .expect(200);
    expect(byActor.body.items).toHaveLength(1);
    const range = await as(http, s.cookie)
      .get(
        `${ws(workspace.id, '/audit-log')}?from=${at(2).toISOString()}&to=${at(3).toISOString()}`,
      )
      .expect(200);
    expect(range.body.items).toHaveLength(4);

    // A cursor from another workspace, a bad limit or a bad date: 422.
    const foreign = await db.auditLog.findFirstOrThrow({
      where: { workspaceId: other.workspace.id },
    });
    for (const q of [`cursor=${foreign.id}`, 'limit=101', 'limit=0', 'from=yesterday']) {
      await as(http, s.cookie)
        .get(`${ws(workspace.id, '/audit-log')}?${q}`)
        .expect(422)
        .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    }

    await as(http, (await loginAs(ctx, teacher)).cookie)
      .get(ws(workspace.id, '/audit-log'))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
  });
});
