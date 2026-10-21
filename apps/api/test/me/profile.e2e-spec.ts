import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createPersonalWorkspace, createUser } from '../helpers/factories';

describe('/me: profile, locale & timezone, workspaces', () => {
  let ctx: TestContext;
  let http: TestAgent;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.http;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  it('GET /me returns the profile with pendingConsents [] and twoFactor', async () => {
    const u = await createUser({ firstName: 'Mohamed', lastName: 'Smairi' });
    const s = await loginAs(ctx, u);
    const { body } = await as(http, s.cookie).get('/api/v1/me').expect(200);
    expect(body).toEqual({
      id: u.id,
      email: u.email,
      firstName: 'Mohamed',
      lastName: 'Smairi',
      locale: 'fr',
      timezone: 'Africa/Tunis',
      birthDate: null,
      phoneE164: null,
      phoneVerifiedAt: null,
      emailVerifiedAt: u.emailVerifiedAt!.toISOString(),
      platformRole: 'NONE',
      status: 'ACTIVE',
      twoFactor: { enabled: false, required: false },
      pendingConsents: [],
    });
    // Never a hash or a secret.
    expect(JSON.stringify(body)).not.toMatch(/hash|secret|totp/i);
  });

  it('GET /me lists the consents still to accept (and stays reachable without them)', async () => {
    const u = await createUser({ consents: ['PRIVACY'] });
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .get('/api/v1/me')
      .expect(200)
      .expect(({ body }) => expect(body.pendingConsents).toEqual(['TERMS']));
  });

  it('PATCH /me updates locale/timezone/birthDate and audits; invalid values are 422', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .patch('/api/v1/me')
      .send({ locale: 'ar', timezone: 'Europe/Paris', birthDate: '2009-05-01' })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          id: u.id,
          locale: 'ar',
          timezone: 'Europe/Paris',
          birthDate: '2009-05-01',
          pendingConsents: [],
        }),
      );
    for (const bad of [
      { timezone: 'Europe/Tunis' },
      { locale: 'de' },
      { birthDate: '2999-01-01' },
      { birthDate: '1850-01-01' },
      { timezone: 'UTC+1' },
      { firstName: '   ' },
      { email: 'other@example.com' },
    ]) {
      await as(http, s.cookie)
        .patch('/api/v1/me')
        .send(bad)
        .expect(422)
        .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    }
    const stored = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored).toMatchObject({ locale: 'ar', timezone: 'Europe/Paris', email: u.email });
    expect(stored.birthDate!.toISOString().slice(0, 10)).toBe('2009-05-01');

    const audits = await ctx.db.auditLog.findMany({ where: { action: 'user.profile_updated' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: u.id,
      entityType: 'User',
      entityId: u.id,
      before: { locale: 'fr', timezone: 'Africa/Tunis', birthDate: null },
      after: { locale: 'ar', timezone: 'Europe/Paris', birthDate: '2009-05-01' },
    });
  });

  it('PATCH /me audits only the keys that changed; a no-op writes no audit entry', async () => {
    const u = await createUser({ firstName: 'Ali' });
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .patch('/api/v1/me')
      .send({ firstName: '  Aly ', locale: 'fr' })
      .expect(200)
      .expect(({ body }) => expect(body.firstName).toBe('Aly'));
    await as(http, s.cookie).patch('/api/v1/me').send({ timezone: 'Africa/Tunis' }).expect(200);
    await as(http, s.cookie).patch('/api/v1/me').send({}).expect(200);
    const audits = await ctx.db.auditLog.findMany({ where: { action: 'user.profile_updated' } });
    expect(audits.map((a) => [a.before, a.after])).toEqual([
      [{ firstName: 'Ali' }, { firstName: 'Aly' }],
    ]);
  });

  it("GET /me/workspaces lists only my memberships, never another user's", async () => {
    const me = await createUser({ firstName: 'Moi' });
    // Owns an organisation below: 2FA is mandatory for them.
    const other = await createUser({ firstName: 'Autre', totpSecret: 'JBSWY3DPEHPK3PXP' });
    const mine = await createPersonalWorkspace(me, { name: 'Zeta perso' });
    const { workspace: org } = await createOrganization({
      owner: await createUser(),
      teachers: [me],
      students: [other],
      name: 'Alpha académie',
    });
    // Another user's personal workspace and organisation: never listed for me.
    await createPersonalWorkspace(other, { name: 'Beta perso' });
    await createOrganization({ owner: other, name: 'Gamma org' });
    // Memberships that are over are not listed.
    const { workspace: left } = await createOrganization({
      owner: await createUser(),
      name: 'Delta ancienne',
    });
    await ctx.db.membership.create({
      data: { workspaceId: left.id, userId: me.id, role: 'STUDENT', status: 'REMOVED' },
    });
    const { workspace: refused } = await createOrganization({
      owner: await createUser(),
      name: 'Epsilon refusée',
    });
    await ctx.db.membership.create({
      data: { workspaceId: refused.id, userId: me.id, role: 'STUDENT', status: 'REJECTED' },
    });
    const { workspace: pending } = await createOrganization({
      owner: await createUser(),
      name: 'Beta en attente',
    });
    await ctx.db.membership.create({
      data: { workspaceId: pending.id, userId: me.id, role: 'STUDENT', status: 'PENDING_APPROVAL' },
    });

    const s = await loginAs(ctx, me);
    const { body } = await as(http, s.cookie).get('/api/v1/me/workspaces').expect(200);
    expect(body).toEqual([
      {
        workspace: {
          id: org.id,
          name: 'Alpha académie',
          slug: org.slug,
          type: 'ORGANIZATION',
          status: 'ACTIVE',
        },
        role: 'TEACHER',
        canTeach: false,
        status: 'ACTIVE',
        guardian: null,
      },
      {
        workspace: {
          id: pending.id,
          name: 'Beta en attente',
          slug: pending.slug,
          type: 'ORGANIZATION',
          status: 'ACTIVE',
        },
        role: 'STUDENT',
        canTeach: false,
        status: 'PENDING_APPROVAL',
        guardian: null,
      },
      {
        workspace: {
          id: mine.id,
          name: 'Zeta perso',
          slug: mine.slug,
          type: 'PERSONAL',
          status: 'ACTIVE',
        },
        role: 'OWNER',
        canTeach: false,
        status: 'ACTIVE',
        guardian: null,
      },
    ]);

    const theirs = await loginAs(ctx, other);
    const res = await as(http, theirs.cookie).get('/api/v1/me/workspaces').expect(200);
    expect(res.body.map((m: { workspace: { name: string } }) => m.workspace.name)).toEqual([
      'Alpha académie',
      'Beta perso',
      'Gamma org',
    ]);
  });

  it('PATCH /me/password and POST /me/email-change still answer on the moved controller', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .patch('/api/v1/me/password')
      .send({ currentPassword: 'wrong wrong wrong', newPassword: 'another long passphrase' })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('INVALID_CREDENTIALS'));
    await as(http, s.cookie)
      .post('/api/v1/me/email-change')
      .send({ newEmail: 'new@example.com', password: u.password })
      .expect(202);
  });
});
