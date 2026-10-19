import { INVITE_CODE_ALPHABET } from '@nibras/contracts';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  createInviteLink,
  createOrganization,
  createPersonalWorkspace,
  createUser,
} from '../helpers/factories';

const S = 'JBSWY3DPEHPK3PXP';
const DAY = 24 * 3600 * 1000;
const CODE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{8}$`);

/** A teacher who passes `@RequireVerifiedTeacher()`: email, phone, code of conduct. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

describe('invite links (group codes): create, list, update, disable (AC-INV-08)', () => {
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
  const links = (wid: string, path = '') => `/api/v1/workspaces/${wid}/invite-links${path}`;
  const join = (code: string) => `/api/v1/join/${code}`;

  async function personal(): Promise<{ teacher: User; workspace: Workspace }> {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher);
    return { teacher, workspace };
  }

  /** An organisation with a verified OWNER, ADMIN and two TEACHERs. */
  async function organisation() {
    const owner = await verifiedUser({ totpSecret: S, firstName: 'Owner' });
    const admin = await verifiedUser({ totpSecret: S, firstName: 'Admin' });
    const teacher = await verifiedUser({ firstName: 'Teacher' });
    const teacher2 = await verifiedUser({ firstName: 'Teacher2' });
    const { workspace } = await createOrganization({
      owner,
      admins: [admin],
      teachers: [teacher, teacher2],
    });
    return { owner, admin, teacher, teacher2, workspace };
  }

  it('creates with defaults: ORGANIZATION → approval required, 50 uses, 30 days, url ends with /join/{code}; audit carries the settings', async () => {
    const { owner, workspace } = await organisation();
    const res = await (await agent(owner)).post(links(workspace.id)).send({}).expect(201);
    expect(res.body).toMatchObject({
      label: null,
      requiresApproval: true,
      maxUses: 50,
      usesCount: 0,
      status: 'ACTIVE',
      createdByUserId: owner.id,
      teacherUserId: null,
      courseIds: [],
    });
    expect(res.body.code).toMatch(CODE);
    expect(res.body.url).toMatch(new RegExp(`/fr/join/${res.body.code}$`));
    const ttl = Date.parse(res.body.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(29.9 * DAY);
    expect(ttl).toBeLessThanOrEqual(30 * DAY);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invite_link.created' } });
    expect(audit).toMatchObject({ entityType: 'InviteLink', entityId: res.body.id });
    expect(audit.after).toMatchObject({
      code: res.body.code,
      maxUses: 50,
      requiresApproval: true,
    });
    expect(ctx.email.sent).toHaveLength(0);
  });

  it('PERSONAL → no approval by default; explicit settings are kept; bounds are enforced', async () => {
    const { teacher, workspace } = await personal();
    const a = await agent(teacher);
    const plain = await a.post(links(workspace.id)).send({}).expect(201);
    expect(plain.body.requiresApproval).toBe(false);

    const expiresAt = new Date(Date.now() + 3 * DAY).toISOString();
    const custom = await a
      .post(links(workspace.id))
      .send({ label: 'Groupe du lundi', requiresApproval: true, maxUses: 2, expiresAt })
      .expect(201);
    expect(custom.body).toMatchObject({
      label: 'Groupe du lundi',
      requiresApproval: true,
      maxUses: 2,
      expiresAt,
    });
    expect(custom.body.code).not.toBe(plain.body.code);

    for (const body of [
      { expiresAt: new Date(Date.now() - 1000).toISOString() },
      { expiresAt: new Date(Date.now() + 366 * DAY).toISOString() },
      { maxUses: 0 },
      { maxUses: 1001 },
      { role: 'TEACHER' },
    ]) {
      const res = await a.post(links(workspace.id)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    // A teacher is only assigned in an organisation.
    const t = await a.post(links(workspace.id)).send({ teacherUserId: teacher.id }).expect(422);
    expect(t.body.details.issues[0].path).toEqual(['teacherUserId']);
  });

  it('teacherUserId: an ADMIN may name an ACTIVE teacher (a student or another workspace’s teacher → 422); an organisation TEACHER is the implicit teacher and may not name another (403)', async () => {
    const { admin, teacher, teacher2, workspace } = await organisation();
    const student = await createUser();
    await db.membership.create({
      data: { workspaceId: workspace.id, userId: student.id, role: 'STUDENT', status: 'ACTIVE' },
    });
    const foreign = await verifiedUser();
    await createOrganization({ owner: await createUser(), teachers: [foreign] });

    const asAdmin = await agent(admin);
    const named = await asAdmin
      .post(links(workspace.id))
      .send({ teacherUserId: teacher.id })
      .expect(201);
    expect(named.body.teacherUserId).toBe(teacher.id);
    await asAdmin.post(links(workspace.id)).send({ teacherUserId: student.id }).expect(422);
    await asAdmin.post(links(workspace.id)).send({ teacherUserId: foreign.id }).expect(422);

    const asTeacher = await agent(teacher);
    const own = await asTeacher.post(links(workspace.id)).send({}).expect(201);
    expect(own.body.teacherUserId).toBe(teacher.id);
    const denied = await asTeacher
      .post(links(workspace.id))
      .send({ teacherUserId: teacher2.id })
      .expect(403);
    expect(denied.body.code).toBe('PERMISSION_DENIED');
  });

  it('scope own: an organisation TEACHER lists and manages only his links (404 otherwise); the ADMIN lists all; expired links are served as EXPIRED', async () => {
    const { admin, teacher, teacher2, workspace } = await organisation();
    const mine = await createInviteLink({ workspace, createdBy: teacher });
    const theirs = await createInviteLink({ workspace, createdBy: teacher2 });
    const old = await createInviteLink({
      workspace,
      createdBy: teacher,
      expiresAt: new Date(Date.now() - 1000),
    });

    const asTeacher = await agent(teacher);
    const list = await asTeacher.get(links(workspace.id)).expect(200);
    expect(list.body.map((l: { id: string }) => l.id).sort()).toEqual(
      [mine.link.id, old.link.id].sort(),
    );
    expect(list.body.find((l: { id: string }) => l.id === old.link.id).status).toBe('EXPIRED');
    await asTeacher
      .patch(links(workspace.id, `/${theirs.link.id}`))
      .send({ label: 'x' })
      .expect(404);
    await asTeacher.delete(links(workspace.id, `/${theirs.link.id}`)).expect(404);

    const all = await (await agent(admin)).get(links(workspace.id)).expect(200);
    expect(all.body).toHaveLength(3);
  });

  it('PATCH: label, approval, uses and expiry are audited before/after; DISABLED → the code answers 410 INVITE_LINK_DISABLED; ACTIVE again works; maxUses below usesCount → 422; maxUses = usesCount → EXHAUSTED', async () => {
    const { teacher, workspace } = await personal();
    const { link, code } = await createInviteLink({ workspace, createdBy: teacher, usesCount: 3 });
    const a = await agent(teacher);
    const url = links(workspace.id, `/${link.id}`);

    const updated = await a
      .patch(url)
      .send({ label: 'Lundi', requiresApproval: true, maxUses: 10, expiresAt: null })
      .expect(200);
    expect(updated.body).toMatchObject({
      label: 'Lundi',
      requiresApproval: true,
      maxUses: 10,
      expiresAt: null,
      status: 'ACTIVE',
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invite_link.updated' } });
    expect(audit.before).toMatchObject({ label: null, requiresApproval: false, maxUses: 50 });
    expect(audit.after).toMatchObject({ label: 'Lundi', requiresApproval: true, maxUses: 10 });

    await a.patch(url).send({ status: 'DISABLED' }).expect(200);
    const disabled = await http.get(join(code)).expect(410);
    expect(disabled.body.code).toBe('INVITE_LINK_DISABLED');
    // Disabled links stay disabled on an unrelated change.
    expect((await a.patch(url).send({ label: 'Mardi' }).expect(200)).body.status).toBe('DISABLED');
    await a.patch(url).send({ status: 'ACTIVE' }).expect(200);
    await http.get(join(code)).expect(200);

    const low = await a.patch(url).send({ maxUses: 2 }).expect(422);
    expect(low.body.details.issues[0].path).toEqual(['maxUses']);
    const full = await a.patch(url).send({ maxUses: 3 }).expect(200);
    expect(full.body.status).toBe('EXHAUSTED');
    expect((await http.get(join(code)).expect(410)).body.code).toBe('INVITE_LINK_EXHAUSTED');
    const reopened = await a.patch(url).send({ maxUses: 4 }).expect(200);
    expect(reopened.body.status).toBe('ACTIVE');

    await a.patch(url).send({}).expect(422);
    await a
      .patch(url)
      .send({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .expect(422);
  });

  it('DELETE → 204, the row is kept as DISABLED and audited; the code answers 410 INVITE_LINK_DISABLED', async () => {
    const { teacher, workspace } = await personal();
    const { link, code } = await createInviteLink({ workspace, createdBy: teacher });
    const a = await agent(teacher);
    await a.delete(links(workspace.id, `/${link.id}`)).expect(204);
    expect((await db.inviteLink.findUniqueOrThrow({ where: { id: link.id } })).status).toBe(
      'DISABLED',
    );
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invite_link.updated' } });
    expect(audit.after).toMatchObject({ status: 'DISABLED' });
    expect((await http.get(join(code)).expect(410)).body.code).toBe('INVITE_LINK_DISABLED');
    // Idempotent.
    await a.delete(links(workspace.id, `/${link.id}`)).expect(204);
  });

  it('gates: an unverified teacher cannot create (403 TEACHER_NOT_VERIFIED); a student has no student.invite; a suspended workspace is read-only (423)', async () => {
    const unverified = await createUser({ consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'] });
    const ws = await createPersonalWorkspace(unverified);
    const res = await (await agent(unverified)).post(links(ws.id)).send({}).expect(403);
    expect(res.body.code).toBe('TEACHER_NOT_VERIFIED');

    const { workspace, teacher } = await personal();
    const student = await createUser();
    await db.membership.create({
      data: { workspaceId: workspace.id, userId: student.id, role: 'STUDENT', status: 'ACTIVE' },
    });
    await (await agent(student)).get(links(workspace.id)).expect(403);

    const suspendedOwner = await verifiedUser();
    const suspended = await createPersonalWorkspace(suspendedOwner, { status: 'SUSPENDED' });
    const { link } = await createInviteLink({ workspace: suspended, createdBy: suspendedOwner });
    const s = await agent(suspendedOwner);
    await s.get(links(suspended.id)).expect(200);
    await s.post(links(suspended.id)).send({}).expect(423);
    await s.delete(links(suspended.id, `/${link.id}`)).expect(423);
    expect(teacher.id).toBeTruthy();
  });

  it('isolation: a link id of another workspace is 404 on PATCH / DELETE and untouched; a malformed id is 404', async () => {
    const { teacher, workspace } = await personal();
    const other = await verifiedUser();
    const b = await createPersonalWorkspace(other);
    const { link: foreign } = await createInviteLink({ workspace: b, createdBy: other });
    const a = await agent(teacher);
    await a
      .patch(links(workspace.id, `/${foreign.id}`))
      .send({ status: 'DISABLED' })
      .expect(404);
    await a.delete(links(workspace.id, `/${foreign.id}`)).expect(404);
    await a.delete(links(workspace.id, '/not-a-uuid')).expect(404);
    expect((await db.inviteLink.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
      'ACTIVE',
    );
    expect((await a.get(links(workspace.id)).expect(200)).body).toEqual([]);
  });
});
