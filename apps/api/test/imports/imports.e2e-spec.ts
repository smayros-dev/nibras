import { INVITATIONS_IMPORT_JOB, importJobId } from '@nibras/contracts';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  addMember,
  createImport,
  createInvitation,
  createOrganization,
  createPersonalWorkspace,
  createUser,
} from '../helpers/factories';

/** Base32 TOTP seed: organisation OWNER/ADMIN clear the 2FA gate with it. */
const S = 'JBSWY3DPEHPK3PXP';

/** A teacher who passes `@RequireVerifiedTeacher()`: email, phone, code of conduct. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

/**
 * The AC-INV-07 file: 100 data rows, 95 distinct valid addresses, 3 invalid emails (lines 11,
 * 31, 51) and 2 duplicates (lines 61, 81: case variants of earlier rows).
 */
function acFile(): { csv: string; invalidLines: number[]; duplicateLines: number[] } {
  const lines = ['email,first_name,last_name,guardian_email,birth_date,course_codes'];
  let k = 0;
  for (let i = 0; i < 100; i += 1) {
    const line = i + 2;
    if (line === 11 || line === 31 || line === 51) lines.push(`not-an-email-${line},X,Y,,,`);
    else if (line === 61) lines.push('Student-0@Example.com,Dup,One,,,');
    else if (line === 81) lines.push('STUDENT-1@example.com,Dup,Two,,,');
    else lines.push(`student-${k++}@example.com,Prenom${k},Nom${k},,,`);
  }
  return { csv: lines.join('\n'), invalidLines: [11, 31, 51], duplicateLines: [61, 81] };
}

describe('CSV import API: preview, confirm, status, report (AC-INV-07)', () => {
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
  const imp = (wid: string, path = '') => `/api/v1/workspaces/${wid}/invitations/import${path}`;

  async function personal(): Promise<{ teacher: User; workspace: Workspace }> {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    return { teacher, workspace: await createPersonalWorkspace(teacher) };
  }

  it('AC-INV-07 preview: 100 rows with 3 invalid emails and 2 duplicates → validRows 95, the 5 lines flagged, no row written, no job', async () => {
    const { teacher, workspace } = await personal();
    const a = await agent(teacher);
    const { csv, invalidLines, duplicateLines } = acFile();
    const res = await a
      .post(imp(workspace.id))
      .query({ dryRun: 'true' })
      .send({ fileName: 'classe.csv', content: csv })
      .expect(200);
    expect(res.body).toMatchObject({ totalRows: 100, validRows: 95 });
    expect(res.body.rows).toHaveLength(100);
    const flagged = (res.body.rows as { line: number; outcome: string }[]).filter(
      (r) => !r.outcome.startsWith('OK'),
    );
    expect(flagged.map((r) => [r.line, r.outcome])).toEqual([
      ...invalidLines.map((l) => [l, 'INVALID_EMAIL']),
      ...duplicateLines.map((l) => [l, 'DUPLICATE_IN_FILE']),
    ]);
    expect(await db.invitationImport.count()).toBe(0);
    expect(await db.invitation.count()).toBe(0);
    expect(ctx.queue.jobs).toEqual([]);
    expect(ctx.email.sent).toEqual([]);
  });

  it('preview flags addresses already members (live membership) or already invited (PENDING); a REMOVED member may be invited again', async () => {
    const { teacher, workspace } = await personal();
    const member = await createUser({ email: 'member@example.com' });
    await addMember(workspace, member, 'STUDENT');
    const removed = await createUser({ email: 'removed@example.com' });
    await addMember(workspace, removed, 'STUDENT', { status: 'REMOVED' });
    await createInvitation({ workspace, invitedBy: teacher, email: 'pending@example.com' });
    await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'revoked@example.com',
      status: 'REVOKED',
    });
    // The same address pending in another workspace changes nothing here.
    const other = await createPersonalWorkspace(await verifiedUser());
    await createInvitation({ workspace: other, invitedBy: teacher, email: 'new@example.com' });

    const a = await agent(teacher);
    const csv = [
      'email',
      'Member@example.com',
      'pending@example.com',
      'removed@example.com',
      'revoked@example.com',
      'new@example.com',
    ].join('\r\n');
    const res = await a
      .post(imp(workspace.id))
      .query({ dryRun: 'true' })
      .send({ fileName: 'x.csv', content: csv })
      .expect(200);
    expect((res.body.rows as { email: string; outcome: string }[]).map((r) => r.outcome)).toEqual([
      'ALREADY_MEMBER',
      'ALREADY_INVITED',
      'OK',
      'OK',
      'OK',
    ]);
    expect(res.body.validRows).toBe(3);
  });

  it('confirm → 202 importId, InvitationImport QUEUED with 95 rows, job { importId, workspaceId } with jobId import:{id}, audit invitations.import_started; a second confirm while QUEUED → 409 IMPORT_IN_PROGRESS; status endpoint; report csv has a BOM and 5 lines before the worker runs', async () => {
    const { teacher, workspace } = await personal();
    const a = await agent(teacher);
    const { csv } = acFile();
    const res = await a
      .post(imp(workspace.id))
      .send({ fileName: 'classe.csv', content: csv })
      .expect(202);
    const { importId } = res.body as { importId: string };
    expect(Object.keys(res.body)).toEqual(['importId']);

    const row = await db.invitationImport.findUniqueOrThrow({ where: { id: importId } });
    expect(row).toMatchObject({
      workspaceId: workspace.id,
      createdByUserId: teacher.id,
      fileName: 'classe.csv',
      status: 'QUEUED',
      totalRows: 100,
      validRows: 95,
      processedRows: 0,
    });
    expect(row.rows).toHaveLength(95);
    expect((row.rows as { email: string }[])[0]).toMatchObject({
      line: 2,
      email: 'student-0@example.com',
      firstName: 'Prenom1',
    });
    expect(row.report).toHaveLength(5);
    expect(await db.invitation.count()).toBe(0);

    expect(ctx.queue.jobs).toEqual([
      {
        queue: 'imports',
        name: INVITATIONS_IMPORT_JOB,
        data: { importId, workspaceId: workspace.id },
        opts: { jobId: importJobId(importId) },
      },
    ]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'invitations.import_started' },
    });
    expect(audit).toMatchObject({
      workspaceId: workspace.id,
      actorUserId: teacher.id,
      entityType: 'InvitationImport',
      entityId: importId,
    });
    expect(audit.after).toEqual({ fileName: 'classe.csv', totalRows: 100, validRows: 95 });

    const again = await a
      .post(imp(workspace.id))
      .send({ fileName: 'classe.csv', content: csv })
      .expect(409);
    expect(again.body.code).toBe('IMPORT_IN_PROGRESS');
    // A dry run is still allowed while an import runs.
    await a
      .post(imp(workspace.id))
      .query({ dryRun: 'true' })
      .send({ fileName: 'classe.csv', content: csv })
      .expect(200);

    const status = await a.get(imp(workspace.id, `/${importId}`)).expect(200);
    expect(status.body).toMatchObject({
      id: importId,
      fileName: 'classe.csv',
      status: 'QUEUED',
      totalRows: 100,
      validRows: 95,
      processedRows: 0,
      createdCount: 0,
      failedCount: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(status.body.report).toHaveLength(5);
    expect(status.body.report[0]).toMatchObject({ line: 11, outcome: 'INVALID_EMAIL' });

    const report = await a.get(imp(workspace.id, `/${importId}/report`)).expect(200);
    expect(report.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(report.headers['content-disposition']).toBe(
      `attachment; filename="import-${importId}.csv"`,
    );
    const text = report.text;
    expect(text.startsWith('\uFEFFline,email,outcome,message\r\n')).toBe(true);
    const lines = text.trimEnd().split('\r\n').slice(1);
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => l.split(',').slice(0, 3).join(','))).toEqual([
      '11,not-an-email-11,INVALID_EMAIL',
      '31,not-an-email-31,INVALID_EMAIL',
      '51,not-an-email-51,INVALID_EMAIL',
      '61,student-0@example.com,DUPLICATE_IN_FILE',
      '81,student-1@example.com,DUPLICATE_IN_FILE',
    ]);
    // Once the import is over, a new one may start.
    await db.invitationImport.update({ where: { id: importId }, data: { status: 'COMPLETED' } });
    await a
      .post(imp(workspace.id))
      .send({ fileName: 'b.csv', content: 'email\nz@x.io' })
      .expect(202);
  });

  it('the report neutralises formula cells (=, +, -, @) from the file', async () => {
    const { teacher, workspace } = await personal();
    const a = await agent(teacher);
    const csv = ['email', '=HYPERLINK("http://evil")', '+cmd', '-2+3', '@SUM(A1)', 'ok@x.io'].join(
      '\n',
    );
    const res = await a
      .post(imp(workspace.id))
      .send({ fileName: 'f.csv', content: csv })
      .expect(202);
    const report = await a.get(imp(workspace.id, `/${res.body.importId}/report`)).expect(200);
    const cells = report.text
      .trimEnd()
      .split('\r\n')
      .slice(1)
      .map((l) => l.replace(/^\d+,/, ''));
    for (const cell of cells) expect(cell).toMatch(/^("?')/);
    expect(report.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('a 1.2 MB content → 413; more than 500 rows → 413 IMPORT_TOO_LARGE; only invalid rows → 422 IMPORT_NO_VALID_ROWS; no email column → 422; dryRun must be true/false', async () => {
    const { teacher, workspace } = await personal();
    const a = await agent(teacher);
    const big = await a
      .post(imp(workspace.id))
      .query({ dryRun: 'true' })
      .send({ fileName: 'big.csv', content: `email\n${'a'.repeat(1_200_000)}` })
      .expect(413);
    expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');

    const rows = ['email', ...Array.from({ length: 501 }, (_, i) => `s${i}@example.com`)];
    const many = await a
      .post(imp(workspace.id))
      .query({ dryRun: 'true' })
      .send({ fileName: 'many.csv', content: rows.join('\n') })
      .expect(413);
    expect(many.body.code).toBe('IMPORT_TOO_LARGE');

    const bad = await a
      .post(imp(workspace.id))
      .send({ fileName: 'bad.csv', content: 'email\nnope\nstill-nope' })
      .expect(422);
    expect(bad.body.code).toBe('IMPORT_NO_VALID_ROWS');

    const noEmail = await a
      .post(imp(workspace.id))
      .send({ fileName: 'n.csv', content: 'name\nA' })
      .expect(422);
    expect(noEmail.body.code).toBe('VALIDATION_FAILED');

    await a
      .post(imp(workspace.id))
      .query({ dryRun: 'yes' })
      .send({ fileName: 'n.csv', content: 'email\na@x.io' })
      .expect(422);
    expect(await db.invitationImport.count()).toBe(0);
    expect(ctx.queue.jobs).toEqual([]);
  });

  it('an unverified teacher → 403 TEACHER_NOT_VERIFIED; a STUDENT → 403', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const res = await (
      await agent(teacher)
    )
      .post(imp(workspace.id))
      .query({ dryRun: 'true' })
      .send({ fileName: 'a.csv', content: 'email\na@x.io' })
      .expect(403);
    expect(res.body.code).toBe('TEACHER_NOT_VERIFIED');

    const student = await createUser();
    await addMember(workspace, student, 'STUDENT');
    await (
      await agent(student)
    )
      .post(imp(workspace.id))
      .query({ dryRun: 'true' })
      .send({ fileName: 'a.csv', content: 'email\na@x.io' })
      .expect(403);
  });

  it('org TEACHER sees only his imports; OWNER sees every import of the workspace; an import of another workspace is 404', async () => {
    const owner = await verifiedUser({ totpSecret: S });
    const t1 = await verifiedUser({ firstName: 'T1' });
    const t2 = await verifiedUser({ firstName: 'T2' });
    const { workspace } = await createOrganization({ owner, teachers: [t1, t2] });
    const mine = await createImport({
      workspace,
      createdBy: t1,
      rows: [{ line: 2, email: 'a@x.io' }],
    });
    const theirs = await createImport({
      workspace,
      createdBy: t2,
      rows: [{ line: 2, email: 'b@x.io' }],
      status: 'COMPLETED',
    });
    const a1 = await agent(t1);
    await a1.get(imp(workspace.id, `/${mine.id}`)).expect(200);
    await a1.get(imp(workspace.id, `/${mine.id}/report`)).expect(200);
    expect((await a1.get(imp(workspace.id, `/${theirs.id}`)).expect(404)).body.code).toBe(
      'NOT_FOUND',
    );
    await a1.get(imp(workspace.id, `/${theirs.id}/report`)).expect(404);

    const ao = await agent(owner);
    await ao.get(imp(workspace.id, `/${mine.id}`)).expect(200);
    await ao.get(imp(workspace.id, `/${theirs.id}`)).expect(200);

    const { teacher: p, workspace: pw } = await personal();
    const foreign = await createImport({ workspace: pw, createdBy: p, rows: [] });
    await ao.get(imp(workspace.id, `/${foreign.id}`)).expect(404);
    await ao.get(imp(workspace.id, '/not-a-uuid')).expect(404);
    // t2's QUEUED import blocks t1's confirm too: one import at a time per workspace.
    await db.invitationImport.update({ where: { id: theirs.id }, data: { status: 'RUNNING' } });
    await db.invitationImport.update({ where: { id: mine.id }, data: { status: 'COMPLETED' } });
    const busy = await a1
      .post(imp(workspace.id))
      .send({ fileName: 'c.csv', content: 'email\nc@x.io' })
      .expect(409);
    expect(busy.body.code).toBe('IMPORT_IN_PROGRESS');
  });

  it('two concurrent confirms → exactly one 202 and one 409 IMPORT_IN_PROGRESS', async () => {
    const { teacher, workspace } = await personal();
    const a = await agent(teacher);
    const send = () =>
      a.post(imp(workspace.id)).send({ fileName: 'c.csv', content: 'email\nc@x.io' });
    const statuses = (await Promise.all([send(), send()])).map((r) => r.status).sort();
    expect(statuses).toEqual([202, 409]);
    expect(await db.invitationImport.count()).toBe(1);
    expect(ctx.queue.jobs).toHaveLength(1);
  });

  it('route order: GET /invitations/import/{id} is not captured by GET /invitations/{id}', async () => {
    const { teacher, workspace } = await personal();
    const row = await createImport({ workspace, createdBy: teacher, rows: [] });
    const a = await agent(teacher);
    const res = await a.get(`/api/v1/workspaces/${workspace.id}/invitations/import/${row.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: row.id, fileName: 'students.csv', status: 'QUEUED' });
    // And an invitation id still reaches the invitations controller.
    const { invitation } = await createInvitation({ workspace, invitedBy: teacher });
    const inv = await a.get(`/api/v1/workspaces/${workspace.id}/invitations/${invitation.id}`);
    expect(inv.status).toBe(200);
    expect(inv.body.id).toBe(invitation.id);
  });
});
