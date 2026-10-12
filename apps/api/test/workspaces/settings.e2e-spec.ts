import { defaultWorkspaceSettings, WorkspaceSettingsSchema } from '@tt/contracts';
import type { PrismaClient } from '@tt/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createPersonalWorkspace, createUser } from '../helpers/factories';

const S = 'JBSWY3DPEHPK3PXP';

describe('WorkspaceSettingsSchema (PRD §8.2.1)', () => {
  const defaults = defaultWorkspaceSettings('Africa/Tunis');

  it('accepts the defaults', () => {
    expect(WorkspaceSettingsSchema.parse(defaults)).toEqual({
      v: 1,
      default_timezone: 'Africa/Tunis',
      teacher_join_window_min: 15,
      student_join_window_min: 10,
      empty_room_grace_min: 5,
      late_threshold_min: 10,
      present_ratio: 0.75,
      partial_ratio: 0.25,
      default_sequential_lessons: false,
      default_pdf_download: false,
      default_reminder_offsets_min: [1440, 15, 0],
    });
  });

  it.each([
    { teacher_join_window_min: 61 },
    { student_join_window_min: -1 },
    { teacher_join_window_min: 1.5 },
    { empty_room_grace_min: 0 },
    { empty_room_grace_min: 31 },
    { late_threshold_min: 61 },
    { present_ratio: 1.01 },
    { partial_ratio: -0.1 },
    { partial_ratio: 0.75 },
    { partial_ratio: 0.8, present_ratio: 0.5 },
    { default_reminder_offsets_min: [10081] },
    { default_reminder_offsets_min: [1, 2, 3, 4, 5, 6] },
    { default_timezone: 'GMT+1' },
    { v: 2 },
    { default_pdf_download: 'yes' },
  ])('refuses %j', (patch) => {
    expect(WorkspaceSettingsSchema.safeParse({ ...defaults, ...patch }).success).toBe(false);
  });

  it('accepts the range bounds', () => {
    const bounds = {
      ...defaults,
      teacher_join_window_min: 60,
      student_join_window_min: 0,
      empty_room_grace_min: 30,
      late_threshold_min: 0,
      present_ratio: 1,
      partial_ratio: 0,
      default_reminder_offsets_min: [10080, 0, 1, 2, 3],
    };
    expect(WorkspaceSettingsSchema.parse(bounds)).toEqual(bounds);
  });
});

describe('/workspaces/{wid}/settings', () => {
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

  const settings = (wid: string) => `/api/v1/workspaces/${wid}/settings`;

  it('GET is open to any active member', async () => {
    const student = await createUser();
    const { workspace } = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      students: [student],
    });
    await as(http, (await loginAs(ctx, student)).cookie)
      .get(settings(workspace.id))
      .expect(200)
      .expect(({ body }) => expect(body).toEqual(defaultWorkspaceSettings('Africa/Tunis')));
    await as(http, (await loginAs(ctx, await createUser())).cookie)
      .get(settings(workspace.id))
      .expect(404);
  });

  it('settings PATCH validates ranges (partial_ratio ≥ present_ratio → 422) and audits before/after', async () => {
    const owner = await createUser({ totpSecret: S });
    const { workspace } = await createOrganization({ owner });
    const s = await loginAs(ctx, owner);

    const { body } = await as(http, s.cookie)
      .patch(settings(workspace.id))
      .send({ present_ratio: 0.8, late_threshold_min: 5, default_reminder_offsets_min: [60] })
      .expect(200);
    expect(body).toEqual({
      ...defaultWorkspaceSettings('Africa/Tunis'),
      present_ratio: 0.8,
      late_threshold_min: 5,
      default_reminder_offsets_min: [60],
    });
    const stored = await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(stored.settings).toEqual(body);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'workspace.settings_updated', workspaceId: workspace.id },
    });
    expect(audit).toMatchObject({
      actorUserId: owner.id,
      actorRole: 'OWNER',
      entityType: 'Workspace',
      entityId: workspace.id,
      before: {
        present_ratio: 0.75,
        late_threshold_min: 10,
        default_reminder_offsets_min: [1440, 15, 0],
      },
      after: { present_ratio: 0.8, late_threshold_min: 5, default_reminder_offsets_min: [60] },
    });
    // Only changed keys are recorded.
    expect(Object.keys(audit.after as object).sort()).toEqual([
      'default_reminder_offsets_min',
      'late_threshold_min',
      'present_ratio',
    ]);

    // The merge is validated against the full schema: partial_ratio ≥ the stored present_ratio.
    const cross = await as(http, s.cookie)
      .patch(settings(workspace.id))
      .send({ partial_ratio: 0.8 })
      .expect(422);
    expect(cross.body.code).toBe('VALIDATION_FAILED');
    expect(cross.body.details.issues).toEqual([
      expect.objectContaining({ path: ['partial_ratio'] }),
    ]);

    for (const bad of [
      { teacher_join_window_min: 61 },
      { empty_room_grace_min: 0 },
      { present_ratio: 2 },
      { default_reminder_offsets_min: [1, 2, 3, 4, 5, 6] },
      { default_reminder_offsets_min: [20000] },
      { default_timezone: 'Mars/Olympus' },
      { unknown_key: 1 },
      { v: 2 },
    ]) {
      await as(http, s.cookie)
        .patch(settings(workspace.id))
        .send(bad)
        .expect(422)
        .expect(({ body: b }) => expect(b.code).toBe('VALIDATION_FAILED'));
    }
    // Nothing changed after the refusals; one audit row only.
    expect(
      (await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).settings,
    ).toEqual(body);
    expect(
      await db.auditLog.count({
        where: { action: 'workspace.settings_updated', workspaceId: workspace.id },
      }),
    ).toBe(1);

    // A no-op patch writes nothing.
    await as(http, s.cookie).patch(settings(workspace.id)).send({ present_ratio: 0.8 }).expect(200);
    expect(
      await db.auditLog.count({
        where: { action: 'workspace.settings_updated', workspaceId: workspace.id },
      }),
    ).toBe(1);
  });

  it('default_timezone also updates the workspace default time zone', async () => {
    const owner = await createUser();
    const personal = await createPersonalWorkspace(owner);
    await as(http, (await loginAs(ctx, owner)).cookie)
      .patch(settings(personal.id))
      .send({ default_timezone: 'africa/casablanca' })
      .expect(200)
      .expect(({ body }) => expect(body.default_timezone).toBe('Africa/Casablanca'));
    const w = await db.workspace.findUniqueOrThrow({ where: { id: personal.id } });
    expect(w.defaultTimezone).toBe('Africa/Casablanca');
  });

  it('a TEACHER of an organisation cannot PATCH settings', async () => {
    const teacher = await createUser();
    const { workspace } = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      teachers: [teacher],
    });
    await as(http, (await loginAs(ctx, teacher)).cookie)
      .patch(settings(workspace.id))
      .send({ late_threshold_min: 5 })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
  });
});
