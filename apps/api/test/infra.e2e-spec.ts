import { setTimeout as sleep } from 'node:timers/promises';
import { Controller, Get, Param } from '@nestjs/common';
import { db as guardedDb } from '@tt/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { FakePwnedClient } from '../src/auth/crypto/hibp';
import { SecretBox } from '../src/auth/crypto/secret-box';
import { RequestContext, type AuthUser } from '../src/common/request-context';
import { DB } from '../src/db/db.module';
import { auditWriteFailures } from '../src/observability/metrics';
import {
  EMAIL_PROVIDER,
  PWNED_CLIENT,
  SECRET_BOX,
  SMS_PROVIDER,
} from '../src/providers/providers.module';
import { QueueService } from '../src/queue/queue.service';
import { createTestApp, type TestContext } from './helpers/app';
import {
  createOrganization,
  createPersonalWorkspace,
  createUser,
  grantConsents,
} from './helpers/factories';
import { Public } from '../src/auth/decorators/public';

/** Mutates the request's store like a guard, yields, then reads it back. */
@Public()
@Controller('__test/context')
class ContextProbeController {
  @Get(':name')
  async probe(@Param('name') name: string): Promise<{ name?: string; requestId?: string }> {
    const store = RequestContext.get();
    if (store) store.user = { firstName: name } as AuthUser;
    await sleep(Math.floor(Math.random() * 20));
    const after = RequestContext.get();
    return { name: after?.user?.firstName, requestId: after?.requestId };
  }
}

describe('test infrastructure', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [ContextProbeController] });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  it('test app boots with fakes and factories create a verified user and an organization', async () => {
    const { email, queue } = ctx;
    const owner = await createUser();
    const { workspace, memberships } = await createOrganization({
      owner,
      teachers: [await createUser()],
      students: [await createUser(), await createUser()],
    });
    expect(memberships).toHaveLength(4);
    expect(workspace.type).toBe('ORGANIZATION');
    expect(email.sent).toEqual([]);
    expect(queue.jobs).toEqual([]);
    // Per-package / per-worktree DB, never tt.
    expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(/_api_test$/);
  });

  it('injects the fakes in place of the real providers', () => {
    expect(ctx.app.get(EMAIL_PROVIDER)).toBe(ctx.email);
    expect(ctx.app.get(SMS_PROVIDER)).toBe(ctx.sms);
    expect(ctx.app.get(QueueService)).toBe(ctx.queue);
    expect(ctx.app.get(PWNED_CLIENT)).toBe(ctx.pwned);
    expect(ctx.pwned).toBeInstanceOf(FakePwnedClient);
    expect(ctx.app.get(DB)).toBe(guardedDb);
    expect(ctx.app.get(SECRET_BOX)).toBeInstanceOf(SecretBox);
  });

  it('createUser hashes the password, verifies the email and seals the TOTP secret', async () => {
    const user = await createUser({ totpSecret: 'JBSWY3DPEHPK3PXP', phoneVerified: true });
    expect(user.password).toBe('correct horse battery staple');
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.totpEnabledAt).toBeInstanceOf(Date);
    const box: SecretBox = ctx.app.get(SECRET_BOX);
    expect(box.open(user.totpSecretEnc!)).toBe('JBSWY3DPEHPK3PXP');

    const unverified = await createUser({ emailVerified: false });
    expect(unverified.emailVerifiedAt).toBeNull();
    expect(unverified.phoneVerifiedAt).toBeNull();
  });

  it('createPersonalWorkspace makes an owner membership with default settings', async () => {
    const owner = await createUser({ firstName: 'Amina' });
    const ws = await createPersonalWorkspace(owner);
    expect(ws).toMatchObject({ type: 'PERSONAL', name: 'Espace de Amina', ownerUserId: owner.id });
    expect(ws.settings).toMatchObject({ v: 1, default_timezone: owner.timezone });
    const members = await ctx.db.membership.findMany({ where: { workspaceId: ws.id } });
    expect(members).toEqual([
      expect.objectContaining({ userId: owner.id, role: 'OWNER', status: 'ACTIVE' }),
    ]);
  });

  it('createOrganization gives every member its role', async () => {
    const [owner, admin, teacher, student] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ]);
    const { memberships } = await createOrganization({
      owner: owner!,
      admins: [admin!],
      teachers: [teacher!],
      students: [student!],
    });
    expect(memberships.map((m) => [m.userId, m.role])).toEqual([
      [owner!.id, 'OWNER'],
      [admin!.id, 'ADMIN'],
      [teacher!.id, 'TEACHER'],
      [student!.id, 'STUDENT'],
    ]);
  });

  it('grantConsents records the current versions', async () => {
    const user = await createUser();
    await grantConsents(user);
    const consents = await ctx.db.consent.findMany({
      where: { userId: user.id },
      orderBy: { type: 'asc' },
    });
    expect(consents.map((c) => [c.type, c.version, c.granted, c.workspaceId])).toEqual([
      ['TERMS', 'terms-2026-10', true, null],
      ['PRIVACY', 'privacy-2026-10', true, null],
    ]);
  });

  it('reset empties the database and the fakes', async () => {
    await createUser();
    await ctx.queue.add('notifications', 'x', {});
    ctx.pwned.add('hunter2hunter2');
    await ctx.reset();
    expect(await ctx.db.user.count()).toBe(0);
    expect(ctx.queue.jobs).toEqual([]);
    await expect(ctx.pwned.isPwned('hunter2hunter2')).resolves.toBe(false);
  });

  it('AuditService writes audit_log as app_user, without secrets', async () => {
    const user = await createUser();
    const audit = ctx.app.get(AuditService);
    await RequestContext.run(
      { requestId: 'infra-1', ip: '203.0.113.9', userAgent: 'vitest', user },
      () =>
        audit.log({
          action: 'user.profile_updated',
          entityType: 'User',
          entityId: user.id,
          before: { firstName: 'Old', passwordHash: user.passwordHash },
          after: { firstName: 'New' },
        }),
    );
    const rows = await ctx.db.auditLog.findMany({ where: { requestId: 'infra-1' } });
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'user.profile_updated',
        actorUserId: user.id,
        actorRole: 'USER',
        ip: '203.0.113.9',
        userAgent: 'vitest',
        before: { firstName: 'Old' },
        after: { firstName: 'New' },
      }),
    ]);
    expect(JSON.stringify(ctx.logs.lines())).not.toContain(user.passwordHash!);
  });

  it('keeps one request context per request under concurrency', async () => {
    const names = Array.from({ length: 25 }, (_, i) => `u${i}`);
    const responses = await Promise.all(
      names.map((n) => ctx.http.get(`/api/v1/__test/context/${n}`).set('X-Request-Id', `rq-${n}`)),
    );
    expect(responses.map((r) => r.body as unknown)).toEqual(
      names.map((n) => ({ name: n, requestId: `rq-${n}` })),
    );
  });

  it('AuditService stores bigints and counts a failed write without logging the query', async () => {
    const user = await createUser();
    const audit = ctx.app.get(AuditService);
    const failures = async () =>
      (await auditWriteFailures.get()).values.find(
        (v) => v.labels.action === 'workspace.quota_changed',
      )?.value ?? 0;
    const initial = await failures();
    await RequestContext.run({ requestId: 'infra-2', ip: '', userAgent: '', user }, async () => {
      await audit.log({
        action: 'workspace.quota_changed',
        entityType: 'Workspace',
        before: { storageQuotaBytes: 21474836480n },
        after: { storageQuotaBytes: 214748364800n },
      });
      // entity_id is a uuid column: the insert fails in Postgres.
      await audit.log({
        action: 'workspace.quota_changed',
        entityType: 'Workspace',
        entityId: 'not-a-uuid',
        after: { marker: 'query-arg-marker' },
      });
    });
    const rows = await ctx.db.auditLog.findMany({ where: { requestId: 'infra-2' } });
    expect(rows).toEqual([
      expect.objectContaining({
        before: { storageQuotaBytes: '21474836480' },
        after: { storageQuotaBytes: '214748364800' },
      }),
    ]);
    expect(await failures()).toBe(initial + 1);
    const failure = ctx.logs.lines().find((l) => l.msg === 'audit log write failed');
    expect(failure).toMatchObject({ level: 50, action: 'workspace.quota_changed' });
    expect(JSON.stringify(ctx.logs.lines())).not.toContain('query-arg-marker');
  });
});
