import { extractFirstLink, type SentEmail } from '@nibras/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PasswordResetService } from '../../src/auth/password-reset.service';
import { createTestApp, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createUser } from '../helpers/factories';

const REQUEST = '/api/v1/me/email-change';
const CONFIRM = '/api/v1/auth/email-change/confirm';

function tokenFrom(mails: SentEmail[]): string {
  expect(mails).toHaveLength(1);
  const link = extractFirstLink(mails[0]!.html, '/confirm-email');
  return new URL(link!).searchParams.get('token')!;
}

describe('email change with double confirmation', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  /** Requests the change and returns both raw tokens (OLD side, NEW side). */
  async function requestChange(newEmail = 'new@example.com', oldEmail = 'old@example.com') {
    const u = await createUser({ email: oldEmail });
    const s = await loginAs(ctx, u);
    const res = await as(ctx.http, s.cookie)
      .post(REQUEST)
      .send({ newEmail, password: u.password })
      .expect(202);
    expect(res.body).toEqual({});
    const normalised = newEmail.trim().toLowerCase();
    return {
      u,
      s,
      tOld: tokenFrom(ctx.email.findByTemplate('auth.email_change_confirm', oldEmail)),
      tNew: tokenFrom(ctx.email.findByTemplate('auth.email_change_confirm', normalised)),
    };
  }

  const confirm = (token: string) => ctx.http.post(CONFIRM).send({ token });
  const emailOf = async (id: string) =>
    (await ctx.db.user.findUniqueOrThrow({ where: { id } })).email;

  it('email change requires both confirmations; email updates only after the second', async () => {
    const { u, tOld, tNew } = await requestChange();
    expect((await confirm(tOld).expect(200)).body.pending).toBe('NEW');
    expect(await emailOf(u.id)).toBe('old@example.com');
    expect((await confirm(tNew).expect(200)).body.pending).toBeNull();
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user.email).toBe('new@example.com');
    expect(user.emailVerifiedAt!.getTime()).toBeGreaterThan(u.emailVerifiedAt!.getTime());

    // The old address is told, the new one is not.
    expect(ctx.email.findByTemplate('security.email_changed', 'old@example.com')).toHaveLength(1);
    expect(
      ctx.email.findByTemplate('security.email_changed', 'old@example.com')[0]!.params,
    ).toEqual({ firstName: u.firstName, newEmail: 'new@example.com' });
    expect(ctx.email.findByTemplate('security.email_changed', 'new@example.com')).toHaveLength(0);

    const audit = await ctx.db.auditLog.findMany({ where: { action: 'auth.email_changed' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: u.id,
      actorUserId: u.id,
      before: { email: 'old@example.com' },
      after: { email: 'new@example.com' },
    });
    const all = JSON.stringify(await ctx.db.auditLog.findMany());
    expect(all).not.toContain(tOld);
    expect(all).not.toContain(tNew);
    expect(all).not.toContain(u.password);

    await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'new@example.com', password: u.password })
      .expect(200);
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: 'old@example.com', password: u.password })
      .expect(401);
  });

  it('either order works: NEW first leaves OLD pending', async () => {
    const { u, tOld, tNew } = await requestChange();
    expect((await confirm(tNew).expect(200)).body.pending).toBe('OLD');
    expect(await emailOf(u.id)).toBe('old@example.com');
    expect((await confirm(tOld).expect(200)).body.pending).toBeNull();
    expect(await emailOf(u.id)).toBe('new@example.com');
  });

  it('sends one confirmation to each address with the new email and a /confirm-email link; tokens stored hashed for 24 h', async () => {
    const { u, tOld, tNew } = await requestChange('  New@Example.COM ');
    for (const to of ['old@example.com', 'new@example.com']) {
      const [mail] = ctx.email.findByTemplate('auth.email_change_confirm', to);
      expect(mail!.params).toMatchObject({ firstName: u.firstName, newEmail: 'new@example.com' });
      expect(extractFirstLink(mail!.html, '/fr/confirm-email?token=')).toBeTruthy();
    }
    expect(tOld).not.toBe(tNew);
    const tokens = await ctx.db.verificationToken.findMany({
      where: { userId: u.id },
      orderBy: { purpose: 'asc' },
    });
    expect(tokens.map((t) => t.purpose).sort()).toEqual(['EMAIL_CHANGE_NEW', 'EMAIL_CHANGE_OLD']);
    for (const t of tokens) {
      expect(t.payload).toEqual({ newEmail: 'new@example.com' });
      expect([tOld, tNew]).not.toContain(t.tokenHash);
      const ttl = t.expiresAt.getTime() - t.createdAt.getTime();
      expect(ttl).toBeGreaterThan(23.9 * 3600_000);
      expect(ttl).toBeLessThanOrEqual(24 * 3600_000 + 5_000);
    }
    const requested = await ctx.db.auditLog.findMany({
      where: { action: 'auth.email_change_requested' },
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]!.after).toEqual({ newEmail: 'new@example.com' });
  });

  it('a wrong password is 401 INVALID_CREDENTIALS: no token, no email, audited without secrets', async () => {
    const u = await createUser({ email: 'old@example.com' });
    const s = await loginAs(ctx, u);
    const res = await as(ctx.http, s.cookie)
      .post(REQUEST)
      .send({ newEmail: 'new@example.com', password: 'pas le bon mot de passe' })
      .expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(ctx.email.sent).toHaveLength(0);
    expect(await ctx.db.verificationToken.count()).toBe(0);
    const failed = await ctx.db.auditLog.findMany({
      where: { action: 'auth.email_change_failed' },
    });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ entityId: u.id, actorUserId: u.id });
    expect(failed[0]!.after).toMatchObject({ reason: 'invalid_credentials' });
    expect(JSON.stringify(failed)).not.toContain('pas le bon');
  });

  it('an address already used (any case, padded) is 409 EMAIL_TAKEN', async () => {
    await createUser({ email: 'taken@example.com' });
    const u = await createUser({ email: 'old@example.com' });
    const s = await loginAs(ctx, u);
    for (const newEmail of [' Taken@Example.com ', 'OLD@example.com']) {
      const res = await as(ctx.http, s.cookie)
        .post(REQUEST)
        .send({ newEmail, password: u.password })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
    }
    expect(ctx.email.sent).toHaveLength(0);
    expect(await ctx.db.verificationToken.count()).toBe(0);
  });

  it('uniqueness is re-checked at confirmation: an address taken meanwhile is 409 EMAIL_TAKEN', async () => {
    const { u, tOld, tNew } = await requestChange();
    await confirm(tOld).expect(200);
    await createUser({ email: 'NEW@example.com' });
    const res = await confirm(tNew).expect(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
    expect(await emailOf(u.id)).toBe('old@example.com');
    expect(ctx.email.findByTemplate('security.email_changed')).toHaveLength(0);
  });

  it('tokens are single-use, expire, and a new request invalidates the previous pair', async () => {
    const first = await requestChange();
    await confirm(first.tOld).expect(200);
    const reused = await confirm(first.tOld).expect(410);
    expect(reused.body.code).toBe('TOKEN_INVALID');

    // A second request replaces the pending pair.
    ctx.email.clear();
    const res = await as(ctx.http, first.s.cookie)
      .post(REQUEST)
      .send({ newEmail: 'other@example.com', password: first.u.password })
      .expect(202);
    expect(res.status).toBe(202);
    await confirm(first.tNew).expect(410);
    const tOld2 = tokenFrom(
      ctx.email.findByTemplate('auth.email_change_confirm', 'old@example.com'),
    );
    const tNew2 = tokenFrom(
      ctx.email.findByTemplate('auth.email_change_confirm', 'other@example.com'),
    );
    expect((await confirm(tOld2).expect(200)).body.pending).toBe('NEW');

    await ctx.db.verificationToken.updateMany({
      where: { userId: first.u.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await confirm(tNew2).expect(410);
    expect(expired.body.code).toBe('TOKEN_INVALID');
    expect(await emailOf(first.u.id)).toBe('old@example.com');

    const failed = await ctx.db.auditLog.findMany({
      where: { action: 'auth.email_change_failed' },
    });
    expect(failed.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(failed)).not.toMatch(
      new RegExp([first.tOld, first.tNew, tNew2].join('|')),
    );
  });

  it('a token of another purpose is 410 TOKEN_INVALID', async () => {
    const u = await createUser({ email: 'old@example.com' });
    await ctx.http.post('/api/v1/auth/password/forgot').send({ email: u.email }).expect(202);
    await ctx.app.get(PasswordResetService).drain();
    const link = extractFirstLink(ctx.email.last()!.html, '/reset-password')!;
    const token = new URL(link).searchParams.get('token')!;
    await confirm(token).expect(410);
  });

  it('both sides confirmed concurrently: the email changes exactly once', async () => {
    for (let round = 0; round < 3; round += 1) {
      await ctx.reset();
      const { u, tOld, tNew } = await requestChange();
      const results = await Promise.all([confirm(tOld), confirm(tNew)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const pendings = results.map((r) => r.body.pending as string | null);
      expect(pendings.filter((p) => p === null)).toHaveLength(1);
      expect(pendings.filter((p) => p !== null)).toHaveLength(1);
      expect(await emailOf(u.id)).toBe('new@example.com');
      expect(ctx.email.findByTemplate('security.email_changed')).toHaveLength(1);
      expect(await ctx.db.auditLog.count({ where: { action: 'auth.email_changed' } })).toBe(1);
    }
  });

  it('one token presented concurrently is claimed once', async () => {
    const { tOld } = await requestChange();
    const results = await Promise.all([1, 2, 3].map(() => confirm(tOld)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
  });

  it('requires authentication to request, validates input, and never logs tokens or the password', async () => {
    const unauth = await ctx.http
      .post(REQUEST)
      .send({ newEmail: 'new@example.com', password: 'x' })
      .expect(401);
    expect(unauth.body.code).toBe('UNAUTHENTICATED');
    const u = await createUser({ email: 'someone@example.com' });
    const s = await loginAs(ctx, u);
    for (const body of [
      { newEmail: 'not-an-email', password: u.password },
      { newEmail: 'ok@example.com', password: 'a'.repeat(257) },
    ]) {
      const res = await as(ctx.http, s.cookie).post(REQUEST).send(body).expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    ctx.logs.clear();
    const { tOld, tNew } = await requestChange('fresh@example.com');
    await confirm(tOld).expect(200);
    await confirm(tNew).expect(200);
    const logs = JSON.stringify(ctx.logs.lines());
    expect(logs).not.toContain(tOld);
    expect(logs).not.toContain(tNew);
    expect(logs).not.toContain(u.password);
  });
});
