import { randomUUID } from 'node:crypto';
import type { PrismaClient, User } from '@tt/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbuseReportsService } from '../../src/abuse-reports/abuse-reports.service';
import { SnapshotRegistry } from '../../src/abuse-reports/snapshot.registry';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createPersonalWorkspace, createUser } from '../helpers/factories';

/** Base32 TOTP seed: super-admins and organisation OWNER/ADMIN clear the 2FA gate with it. */
const S = 'JBSWY3DPEHPK3PXP';
const DESCRIPTION = 'Comportement inapproprié pendant la session.';

const wsReports = (wid: string, path = '') => `/api/v1/workspaces/${wid}/abuse-reports${path}`;
const adminReports = (path = '') => `/api/v1/admin/abuse-reports${path}`;

describe('abuse reports: snapshot, queues, MINOR_SAFETY escalation (AC-SAFE-05, Review Focus 1)', () => {
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

  /** An organisation (owner, admin, teacher, student) and a super-admin. */
  async function orgFixture() {
    const sa = await createUser({ platformRole: 'SUPER_ADMIN', totpSecret: S });
    const owner = await createUser({ totpSecret: S });
    const admin = await createUser({ totpSecret: S });
    const teacher = await createUser();
    const student = await createUser();
    const { workspace } = await createOrganization({
      owner,
      admins: [admin],
      teachers: [teacher],
      students: [student],
    });
    return { sa, owner, admin, teacher, student, workspace };
  }

  it('a student reports a teacher in an organisation: OPEN report with USER snapshot, ack email, admins + (for MINOR_SAFETY) super-admins notified, reminder job queued', async () => {
    const { sa, owner, admin, teacher, student, workspace } = await orgFixture();
    const res = await (
      await agent(student)
    )
      .post(wsReports(workspace.id))
      .send({
        category: 'MINOR_SAFETY',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: teacher.id,
      })
      .expect(201);
    expect(res.body).toEqual({ id: expect.any(String), status: 'OPEN' });

    const report = await db.abuseReport.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(report).toMatchObject({
      status: 'OPEN',
      category: 'MINOR_SAFETY',
      reporterUserId: student.id,
      workspaceId: workspace.id,
      entityType: 'USER',
      entityId: teacher.id,
      description: DESCRIPTION,
    });
    expect(report.contextSnapshot).toMatchObject({
      userId: teacher.id,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      membership: { role: 'TEACHER', status: 'ACTIVE' },
      capturedAt: expect.any(String),
    });

    expect(ctx.email.findByTemplate('abuse.report_received', student.email)).toHaveLength(1);
    expect(ctx.email.findByTemplate('abuse.new_report', owner.email)).toHaveLength(1);
    expect(ctx.email.findByTemplate('abuse.new_report', admin.email)).toHaveLength(1);
    expect(ctx.email.findByTemplate('abuse.new_report', sa.email)).toHaveLength(1);
    expect(ctx.email.findByTemplate('abuse.new_report', teacher.email)).toHaveLength(0);
    expect(ctx.email.findByTemplate('abuse.new_report', student.email)).toHaveLength(0);
    // Nothing reaches the reported teacher, and no email names the reporter.
    expect(ctx.email.sent.filter((m) => m.to === teacher.email)).toHaveLength(0);
    for (const m of ctx.email.findByTemplate('abuse.new_report')) {
      expect(m.html).not.toContain(student.email);
      expect(m.text).not.toContain(student.email);
    }
    const [saMail] = ctx.email.findByTemplate('abuse.new_report', sa.email);
    expect(saMail!.params.link).toContain(`/admin/abuse-reports/${report.id}`);

    expect(ctx.queue.jobs).toContainEqual(
      expect.objectContaining({
        queue: 'compliance',
        name: 'abuse.minor_safety_reminder',
        data: { reportId: report.id },
        opts: expect.objectContaining({
          delay: 24 * 3600 * 1000,
          jobId: `abuse:${report.id}:minor-safety-reminder`,
        }),
      }),
    );

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'abuse_report.created', entityId: report.id },
    });
    expect(audit).toMatchObject({
      actorUserId: student.id,
      actorRole: 'STUDENT',
      workspaceId: workspace.id,
      entityType: 'AbuseReport',
    });
    expect(audit.after).toEqual({
      category: 'MINOR_SAFETY',
      status: 'OPEN',
      entityType: 'USER',
      entityId: teacher.id,
      reporterUserId: student.id,
    });
  });

  it('HARASSMENT in an organisation notifies admins only; in a personal workspace only super-admins; owner of a personal workspace cannot list reports (403)', async () => {
    const { sa, owner, admin, teacher, student, workspace } = await orgFixture();
    await (
      await agent(student)
    )
      .post(wsReports(workspace.id))
      .send({
        category: 'HARASSMENT',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: teacher.id,
      })
      .expect(201);
    expect(ctx.email.findByTemplate('abuse.new_report', owner.email)).toHaveLength(1);
    expect(ctx.email.findByTemplate('abuse.new_report', admin.email)).toHaveLength(1);
    expect(ctx.email.findByTemplate('abuse.new_report', sa.email)).toHaveLength(0);
    expect(ctx.queue.jobs).toHaveLength(0);

    ctx.email.clear();
    const solo = await createUser({ firstName: 'Solo' });
    const pupil = await createUser();
    const personal = await createPersonalWorkspace(solo);
    await db.membership.create({
      data: { workspaceId: personal.id, userId: pupil.id, role: 'STUDENT', status: 'ACTIVE' },
    });
    await (
      await agent(pupil)
    )
      .post(wsReports(personal.id))
      .send({
        category: 'HARASSMENT',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: solo.id,
      })
      .expect(201);
    expect(ctx.email.findByTemplate('abuse.new_report', sa.email)).toHaveLength(1);
    expect(ctx.email.findByTemplate('abuse.new_report', solo.email)).toHaveLength(0);
    expect(ctx.email.findByTemplate('abuse.report_received', pupil.email)).toHaveLength(1);

    const soloAgent = await agent(solo);
    const denied = await soloAgent.get(wsReports(personal.id)).expect(403);
    expect(denied.body.code).toBe('PERMISSION_DENIED');
    const [row] = await db.abuseReport.findMany({ where: { workspaceId: personal.id } });
    await soloAgent
      .patch(wsReports(personal.id, `/${row!.id}`))
      .send({ status: 'DISMISSED' })
      .expect(403);
  });

  it('escalation emails to the super-admins go out concurrently; one failed send does not block the others', async () => {
    const admins = await Promise.all(
      Array.from({ length: 4 }, () => createUser({ platformRole: 'SUPER_ADMIN' })),
    );
    const solo = await createUser();
    const pupil = await createUser();
    const personal = await createPersonalWorkspace(solo);
    await db.membership.create({
      data: { workspaceId: personal.id, userId: pupil.id, role: 'STUDENT', status: 'ACTIVE' },
    });
    const failing = admins[0]!.email;
    const send = ctx.email.send.bind(ctx.email);
    let inFlight = 0;
    let maxInFlight = 0;
    const spy = vi.spyOn(ctx.email, 'send').mockImplementation(async (msg) => {
      if (msg.templateKey !== 'abuse.new_report') return send(msg);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (msg.to === failing) throw new Error('smtp down');
        return await send(msg);
      } finally {
        inFlight -= 1;
      }
    });
    try {
      await (
        await agent(pupil)
      )
        .post(wsReports(personal.id))
        .send({
          category: 'HARASSMENT',
          description: DESCRIPTION,
          entityType: 'USER',
          entityId: solo.id,
        })
        .expect(201);
    } finally {
      spy.mockRestore();
    }
    expect(maxInFlight).toBe(admins.length);
    expect(ctx.email.findByTemplate('abuse.new_report', failing)).toHaveLength(0);
    for (const sa of admins.slice(1)) {
      expect(ctx.email.findByTemplate('abuse.new_report', sa.email)).toHaveLength(1);
    }
    expect(ctx.email.findByTemplate('abuse.report_received', pupil.email)).toHaveLength(1);
    expect(await db.abuseReport.count({ where: { workspaceId: personal.id } })).toBe(1);
  });

  it('HARASSMENT against the org owner who is its only admin escalates to the super-admins; the owner gets nothing', async () => {
    const sa = await createUser({ platformRole: 'SUPER_ADMIN', totpSecret: S });
    const owner = await createUser({ totpSecret: S });
    const student = await createUser();
    const { workspace } = await createOrganization({ owner, students: [student] });
    await (
      await agent(student)
    )
      .post(wsReports(workspace.id))
      .send({
        category: 'HARASSMENT',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: owner.id,
      })
      .expect(201);
    const [saMail] = ctx.email.findByTemplate('abuse.new_report', sa.email);
    expect(saMail).toBeDefined();
    expect(saMail!.params.link).toContain('/admin/abuse-reports/');
    expect(ctx.email.sent.filter((m) => m.to === owner.email)).toHaveLength(0);
    expect(ctx.email.findByTemplate('abuse.report_received', student.email)).toHaveLength(1);
  });

  it('HARASSMENT against an org admin escalates to the super-admins too; the other handlers are notified, the reported admin is not', async () => {
    const sa = await createUser({ platformRole: 'SUPER_ADMIN', totpSecret: S });
    const owner = await createUser({ totpSecret: S });
    const admin = await createUser({ totpSecret: S });
    const student = await createUser();
    const { workspace } = await createOrganization({ owner, admins: [admin], students: [student] });
    await (
      await agent(student)
    )
      .post(wsReports(workspace.id))
      .send({
        category: 'HARASSMENT',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: admin.id,
      })
      .expect(201);
    expect(ctx.email.findByTemplate('abuse.new_report', sa.email)).toHaveLength(1);
    expect(ctx.email.findByTemplate('abuse.new_report', owner.email)).toHaveLength(1);
    expect(ctx.email.sent.filter((m) => m.to === admin.email)).toHaveLength(0);
    expect(ctx.queue.jobs).toHaveLength(0);
  });

  it('AC-SAFE-05: MINOR_SAFETY report handled by the org stays visible to the super-admin', async () => {
    const { sa, admin, teacher, student, workspace } = await orgFixture();
    const created = await (
      await agent(student)
    )
      .post(wsReports(workspace.id))
      .send({
        category: 'MINOR_SAFETY',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: teacher.id,
      })
      .expect(201);
    const id = created.body.id as string;

    const adminAgent = await agent(admin);
    const list = await adminAgent.get(wsReports(workspace.id)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id,
      reporter: { userId: student.id, firstName: student.firstName, lastName: student.lastName },
      contextSnapshot: { userId: teacher.id },
      status: 'OPEN',
    });
    const patched = await adminAgent
      .patch(wsReports(workspace.id, `/${id}`))
      .send({ status: 'IN_REVIEW', assignedToUserId: admin.id })
      .expect(200);
    expect(patched.body).toMatchObject({
      id,
      status: 'IN_REVIEW',
      assignedToUserId: admin.id,
      resolvedAt: null,
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'abuse_report.updated', entityId: id },
    });
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      actorRole: 'ADMIN',
      workspaceId: workspace.id,
    });
    expect(audit.before).toMatchObject({ status: 'OPEN', assignedToUserId: null });
    expect(audit.after).toMatchObject({ status: 'IN_REVIEW', assignedToUserId: admin.id });

    const saAgent = await agent(sa);
    const queue = await saAgent.get(adminReports()).expect(200);
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(id);
    const minor = await saAgent.get(adminReports('?category=MINOR_SAFETY')).expect(200);
    expect(minor.body.items).toEqual([expect.objectContaining({ id, status: 'IN_REVIEW' })]);
    const byWs = await saAgent.get(adminReports(`?workspaceId=${workspace.id}`)).expect(200);
    expect(byWs.body.items).toHaveLength(1);
    const one = await saAgent.get(adminReports(`/${id}`)).expect(200);
    expect(one.body).toMatchObject({
      id,
      category: 'MINOR_SAFETY',
      contextSnapshot: { userId: teacher.id },
    });
    await saAgent.get(adminReports(`/${randomUUID()}`)).expect(404);

    // The super-admin closes it: resolvedAt is set, the org sees the outcome.
    const resolved = await saAgent
      .patch(adminReports(`/${id}`))
      .send({ status: 'RESOLVED', resolution: 'Professeur suspendu.' })
      .expect(200);
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', resolution: 'Professeur suspendu.' });
    expect(resolved.body.resolvedAt).toEqual(expect.any(String));
    const saAudit = await db.auditLog.findFirstOrThrow({
      where: { action: 'abuse_report.updated', entityId: id, actorUserId: sa.id },
    });
    expect(saAudit).toMatchObject({ actorRole: 'SUPER_ADMIN', workspaceId: workspace.id });

    // Non super-admins: 403 on the admin queue.
    expect((await adminAgent.get(adminReports()).expect(403)).body.code).toBe('PERMISSION_DENIED');
    await adminAgent
      .patch(adminReports(`/${id}`))
      .send({ status: 'OPEN' })
      .expect(403);
  });

  it('Review Focus 1: GET /me/abuse-reports returns only my reports; the reported teacher cannot read the report via any route', async () => {
    const { owner, teacher, student, workspace } = await orgFixture();
    const other = await createUser();
    const studentAgent = await agent(student);
    const mine = await studentAgent
      .post(wsReports(workspace.id))
      .send({
        category: 'HARASSMENT',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: teacher.id,
      })
      .expect(201);
    // A report outside any workspace by someone else.
    await (
      await agent(other)
    )
      .post('/api/v1/abuse-reports')
      .send({
        category: 'IMPERSONATION',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: teacher.id,
      })
      .expect(201);

    const me = await studentAgent.get('/api/v1/me/abuse-reports').expect(200);
    expect(me.body).toEqual({
      items: [
        {
          id: mine.body.id,
          category: 'HARASSMENT',
          status: 'OPEN',
          entityType: 'USER',
          createdAt: expect.any(String),
          resolvedAt: null,
        },
      ],
      nextCursor: null,
    });

    const teacherAgent = await agent(teacher);
    expect((await teacherAgent.get('/api/v1/me/abuse-reports').expect(200)).body.items).toEqual([]);
    await teacherAgent.get(wsReports(workspace.id)).expect(403);
    await teacherAgent
      .patch(wsReports(workspace.id, `/${mine.body.id}`))
      .send({ status: 'DISMISSED' })
      .expect(403);
    await teacherAgent.get(adminReports()).expect(403);

    // A reported org ADMIN does not see (nor handle) reports about himself in the org queue.
    await db.membership.updateMany({
      where: { workspaceId: workspace.id, userId: teacher.id },
      data: { role: 'ADMIN' },
    });
    await db.user.update({
      where: { id: teacher.id },
      data: {
        totpSecretEnc: (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).totpSecretEnc,
        totpEnabledAt: new Date(),
      },
    });
    const promoted = await agent(await db.user.findUniqueOrThrow({ where: { id: teacher.id } }));
    expect((await promoted.get(wsReports(workspace.id)).expect(200)).body.items).toEqual([]);
    await promoted.get(wsReports(workspace.id, `/${mine.body.id}`)).expect(404);
    // The owner (not reported) does see it.
    const ownerView = await (
      await agent(owner)
    )
      .get(wsReports(workspace.id, `/${mine.body.id}`))
      .expect(200);
    expect(ownerView.body).toMatchObject({ id: mine.body.id, workspaceId: workspace.id });
    await promoted
      .patch(wsReports(workspace.id, `/${mine.body.id}`))
      .send({ status: 'DISMISSED' })
      .expect(404);

    // Tenant isolation: another organisation's admin cannot reach the report.
    const otherOwner = await createUser({ totpSecret: S });
    const { workspace: other2 } = await createOrganization({ owner: otherOwner });
    const otherAgent = await agent(otherOwner);
    expect((await otherAgent.get(wsReports(other2.id)).expect(200)).body.items).toEqual([]);
    await otherAgent.get(wsReports(other2.id, `/${mine.body.id}`)).expect(404);
    await otherAgent
      .patch(wsReports(other2.id, `/${mine.body.id}`))
      .send({ status: 'DISMISSED' })
      .expect(404);
    expect((await db.abuseReport.findUniqueOrThrow({ where: { id: mine.body.id } })).status).toBe(
      'OPEN',
    );
    // …and not as a non-member of the reporting workspace either.
    await otherAgent.get(wsReports(workspace.id)).expect(404);
  });

  it('entityType MESSAGE without a registered snapshotter is 422 ENTITY_TYPE_UNSUPPORTED; isEntityUnderReview flips with status', async () => {
    const { owner, teacher, student, workspace } = await orgFixture();
    const studentAgent = await agent(student);
    const unsupported = await studentAgent
      .post(wsReports(workspace.id))
      .send({
        category: 'OTHER',
        description: DESCRIPTION,
        entityType: 'MESSAGE',
        entityId: randomUUID(),
      })
      .expect(422);
    expect(unsupported.body.code).toBe('ENTITY_TYPE_UNSUPPORTED');

    // Outside a workspace only USER reports are accepted.
    const account = await studentAgent
      .post('/api/v1/abuse-reports')
      .send({
        category: 'OTHER',
        description: DESCRIPTION,
        entityType: 'COURSE',
        entityId: randomUUID(),
      })
      .expect(422);
    expect(account.body.code).toBe('ENTITY_TYPE_UNSUPPORTED');

    // A user who is not a member of the workspace is not found there (no cross-workspace probing).
    const outsider = await createUser();
    await studentAgent
      .post(wsReports(workspace.id))
      .send({
        category: 'OTHER',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: outsider.id,
      })
      .expect(404);
    await studentAgent
      .post('/api/v1/abuse-reports')
      .send({
        category: 'OTHER',
        description: DESCRIPTION,
        entityType: 'USER',
        entityId: randomUUID(),
      })
      .expect(404);
    const short = await studentAgent
      .post(wsReports(workspace.id))
      .send({ category: 'OTHER', description: 'court', entityType: 'USER', entityId: teacher.id })
      .expect(422);
    expect(short.body.code).toBe('VALIDATION_FAILED');

    // A provider registered later (SP8) makes MESSAGE reportable.
    const registry = ctx.app.get(SnapshotRegistry);
    const messageId = randomUUID();
    registry.register('MESSAGE', (entityId) =>
      Promise.resolve(entityId === messageId ? { messageId, body: 'hello' } : null),
    );
    const created = await studentAgent
      .post(wsReports(workspace.id))
      .send({
        category: 'HARASSMENT',
        description: DESCRIPTION,
        entityType: 'MESSAGE',
        entityId: messageId,
      })
      .expect(201);

    const service = ctx.app.get(AbuseReportsService);
    expect(await service.isEntityUnderReview('MESSAGE', messageId)).toBe(true);
    expect(await service.isEntityUnderReview('MESSAGE', randomUUID())).toBe(false);
    const ownerAgent = await agent(owner);
    await ownerAgent
      .patch(wsReports(workspace.id, `/${created.body.id}`))
      .send({ status: 'IN_REVIEW' })
      .expect(200);
    expect(await service.isEntityUnderReview('MESSAGE', messageId)).toBe(true);
    const dismissed = await ownerAgent
      .patch(wsReports(workspace.id, `/${created.body.id}`))
      .send({ status: 'DISMISSED' })
      .expect(200);
    expect(dismissed.body.resolvedAt).toEqual(expect.any(String));
    expect(await service.isEntityUnderReview('MESSAGE', messageId)).toBe(false);
    // Reopening clears resolvedAt.
    const reopened = await ownerAgent
      .patch(wsReports(workspace.id, `/${created.body.id}`))
      .send({ status: 'OPEN' })
      .expect(200);
    expect(reopened.body.resolvedAt).toBeNull();
    expect(await service.isEntityUnderReview('MESSAGE', messageId)).toBe(true);
  });

  it('lists are paginated newest first with a stable cursor; an assignee outside the workspace staff is 422', async () => {
    const { owner, teacher, student, workspace } = await orgFixture();
    const studentAgent = await agent(student);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await studentAgent
        .post(wsReports(workspace.id))
        .send({
          category: 'OTHER',
          description: `${DESCRIPTION} ${i}`,
          entityType: 'USER',
          entityId: teacher.id,
        })
        .expect(201);
      ids.push(r.body.id as string);
    }
    const ownerAgent = await agent(owner);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const page = await ownerAgent.get(wsReports(workspace.id, q)).expect(200);
      seen.push(...page.body.items.map((r: { id: string }) => r.id));
      cursor = page.body.nextCursor as string | null;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());

    const mine: string[] = [];
    cursor = null;
    do {
      const q: string = cursor ? `?limit=3&cursor=${cursor}` : '?limit=3';
      const page = await studentAgent.get(`/api/v1/me/abuse-reports${q}`).expect(200);
      mine.push(...page.body.items.map((r: { id: string }) => r.id));
      cursor = page.body.nextCursor as string | null;
    } while (cursor);
    expect(mine).toEqual([...ids].reverse());

    const bad = await ownerAgent
      .patch(wsReports(workspace.id, `/${ids[0]}`))
      .send({ assignedToUserId: teacher.id })
      .expect(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    await ownerAgent.get(wsReports(workspace.id, `?cursor=${randomUUID()}`)).expect(422);
  });
});
