import * as consentVersions from '@tt/contracts';
import { CONSENT_VERSIONS } from '@tt/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createUser, grantConsents } from '../helpers/factories';

describe('/me/consents: versioned consents and the consents gate (AC-GDPR-06)', () => {
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const bumpTerms = () =>
    vi
      .spyOn(consentVersions, 'CONSENT_VERSIONS', 'get')
      .mockReturnValue({ ...CONSENT_VERSIONS, TERMS: 'terms-2027-01' } as never);

  it('AC-GDPR-06: after a TERMS version bump every non-auth route is 403 CONSENT_REQUIRED until the new version is granted', async () => {
    const u = await createUser();
    await grantConsents(u);
    const s = await loginAs(ctx, u);
    await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
    bumpTerms();
    await as(http, s.cookie)
      .get('/api/v1/auth/sessions')
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('CONSENT_REQUIRED');
        expect(body.details.pending).toEqual(['TERMS']);
      });
    // GET /me stays reachable and tells the client what to accept.
    await as(http, s.cookie)
      .get('/api/v1/me')
      .expect(200)
      .expect(({ body }) => expect(body.pendingConsents).toEqual(['TERMS']));
    await as(http, s.cookie)
      .post('/api/v1/me/consents/TERMS')
      .send({ version: 'terms-2026-10' })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('CONSENT_VERSION_MISMATCH'));
    await as(http, s.cookie)
      .post('/api/v1/me/consents/TERMS')
      .set('User-Agent', 'consent-browser/1.0')
      .send({ version: 'terms-2027-01' })
      .expect(201);
    await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
    expect(await ctx.db.consent.count({ where: { userId: u.id, type: 'TERMS' } })).toBe(2);
    const granted = await ctx.db.consent.findFirstOrThrow({
      where: { userId: u.id, type: 'TERMS', version: 'terms-2027-01' },
    });
    expect(granted).toMatchObject({
      granted: true,
      revokedAt: null,
      workspaceId: null,
      grantedByUserId: u.id,
      userAgent: 'consent-browser/1.0',
    });
    expect(granted.ip).toMatch(/127\.0\.0\.1/);
    expect(
      await ctx.db.auditLog.findFirst({ where: { action: 'consent.granted', actorUserId: u.id } }),
    ).toMatchObject({
      entityType: 'Consent',
      entityId: granted.id,
      after: { type: 'TERMS', version: 'terms-2027-01' },
    });
  });

  it('gate order: suspended → email unverified → pending consents → 2FA setup', async () => {
    const unverified = await createUser({ emailVerified: false, consents: [] });
    const s1 = await loginAs(ctx, unverified);
    await as(http, s1.cookie)
      .get('/api/v1/auth/sessions')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_NOT_VERIFIED'));

    const admin = await createUser({ platformRole: 'SUPER_ADMIN', consents: ['PRIVACY'] });
    const s2 = await loginAs(ctx, admin);
    await as(http, s2.cookie)
      .get('/api/v1/auth/sessions')
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('CONSENT_REQUIRED');
        expect(body.details).toEqual({ pending: ['TERMS'] });
      });
    // The grant route is exempt from the gates (it is how the gate is cleared).
    await as(http, s2.cookie)
      .post('/api/v1/me/consents/TERMS')
      .send({ version: CONSENT_VERSIONS.TERMS })
      .expect(201);
    await as(http, s2.cookie)
      .get('/api/v1/auth/sessions')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_SETUP_REQUIRED'));
  });

  it('the login response lists the consents still to accept', async () => {
    const u = await createUser({ consents: ['TERMS'] });
    await http
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('OK');
        expect(body.user.pendingConsents).toEqual(['PRIVACY']);
      });
  });

  it('a user without any consent row is gated on both required types', async () => {
    const u = await createUser({ consents: [] });
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .get('/api/v1/auth/sessions')
      .expect(403)
      .expect(({ body }) => expect(body.details.pending).toEqual(['TERMS', 'PRIVACY']));
    // Unverified users can grant too (exempt route), and the grant is idempotent.
    for (let i = 0; i < 2; i++) {
      await as(http, s.cookie)
        .post('/api/v1/me/consents/TERMS')
        .send({ version: CONSENT_VERSIONS.TERMS })
        .expect(201);
    }
    await as(http, s.cookie)
      .post('/api/v1/me/consents/PRIVACY')
      .send({ version: CONSENT_VERSIONS.PRIVACY })
      .expect(201);
    expect(await ctx.db.consent.count({ where: { userId: u.id } })).toBe(2);
    expect(await ctx.db.auditLog.count({ where: { action: 'consent.granted' } })).toBe(2);
    await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
  });

  it('concurrent grants of the same version create a single row', async () => {
    const u = await createUser({ consents: [] });
    const s = await loginAs(ctx, u);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        as(http, s.cookie).post('/api/v1/me/consents/TERMS').send({ version: CONSENT_VERSIONS.TERMS }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await ctx.db.consent.count({ where: { userId: u.id, type: 'TERMS' } })).toBe(1);
  });

  it('revoking TERMS is 422 CONSENT_NOT_REVOCABLE; MARKETING can be granted then revoked', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .post('/api/v1/me/consents/TERMS/revoke')
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('CONSENT_NOT_REVOCABLE'));
    await as(http, s.cookie)
      .post('/api/v1/me/consents/PRIVACY/revoke')
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('CONSENT_NOT_REVOCABLE'));
    expect(
      await ctx.db.consent.count({ where: { userId: u.id, revokedAt: { not: null } } }),
    ).toBe(0);

    await as(http, s.cookie)
      .post('/api/v1/me/consents/MARKETING')
      .send({ version: 'marketing-2026-10' })
      .expect(201);
    const listed = await as(http, s.cookie).get('/api/v1/me/consents').expect(200);
    expect(listed.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'MARKETING',
          version: 'marketing-2026-10',
          revokedAt: null,
          current: true,
        }),
        expect.objectContaining({ type: 'TERMS', version: 'terms-2026-10', current: true }),
        expect.objectContaining({ type: 'PRIVACY', version: 'privacy-2026-10', current: true }),
      ]),
    );
    expect(listed.body).toHaveLength(3);

    await as(http, s.cookie).post('/api/v1/me/consents/MARKETING/revoke').expect(204);
    // Idempotent: nothing left to revoke, nothing audited.
    await as(http, s.cookie).post('/api/v1/me/consents/MARKETING/revoke').expect(204);
    const marketing = await ctx.db.consent.findFirstOrThrow({
      where: { userId: u.id, type: 'MARKETING' },
    });
    expect(marketing.revokedAt).toBeInstanceOf(Date);
    const revokedAudits = await ctx.db.auditLog.findMany({ where: { action: 'consent.revoked' } });
    expect(revokedAudits).toHaveLength(1);
    expect(revokedAudits[0]).toMatchObject({
      actorUserId: u.id,
      entityType: 'Consent',
      entityId: marketing.id,
      before: { type: 'MARKETING', version: 'marketing-2026-10', revokedAt: null },
    });
    const after = await as(http, s.cookie).get('/api/v1/me/consents').expect(200);
    expect(
      after.body.find((c: { type: string }) => c.type === 'MARKETING').revokedAt,
    ).toEqual(marketing.revokedAt!.toISOString());
    // Revoking marketing never gates the account.
    await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
  });

  it('GET /me/consents marks a superseded version as not current', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    bumpTerms();
    // The listing is behind the gate like every non-exempt route.
    await as(http, s.cookie)
      .get('/api/v1/me/consents')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('CONSENT_REQUIRED'));
    await as(http, s.cookie)
      .post('/api/v1/me/consents/TERMS')
      .send({ version: 'terms-2027-01' })
      .expect(201);
    const listed = await as(http, s.cookie).get('/api/v1/me/consents').expect(200);
    const terms = listed.body.filter((c: { type: string }) => c.type === 'TERMS');
    expect(terms).toEqual([
      expect.objectContaining({ version: 'terms-2027-01', current: true }),
      expect.objectContaining({ version: 'terms-2026-10', current: false }),
    ]);
  });

  it('unknown or workspace-level consent types and bad bodies are 422 VALIDATION_FAILED', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    for (const [url, body] of [
      ['/api/v1/me/consents/RECORDING', { version: 'x' }],
      ['/api/v1/me/consents/GUARDIAN_PARENTAL', { version: 'x' }],
      ['/api/v1/me/consents/nope', { version: 'x' }],
      ['/api/v1/me/consents/TERMS', {}],
      ['/api/v1/me/consents/TERMS', { version: '' }],
    ] as const) {
      await as(http, s.cookie)
        .post(url)
        .send(body)
        .expect(422)
        .expect(({ body: b }) => expect(b.code).toBe('VALIDATION_FAILED'));
    }
  });
});
