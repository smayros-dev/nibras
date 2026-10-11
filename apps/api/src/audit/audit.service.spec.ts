import { Prisma } from '@tt/db';
import { describe, expect, it, vi } from 'vitest';
import { RequestContext, type AuthUser, type RequestStore } from '../common/request-context';
import { AuditService } from './audit.service';

const user: AuthUser = {
  id: '01900000-0000-7000-8000-000000000001',
  email: 'owner@example.com',
  status: 'ACTIVE',
  platformRole: 'NONE',
  locale: 'fr',
  timezone: 'Africa/Tunis',
  emailVerifiedAt: new Date(),
  phoneVerifiedAt: null,
  totpEnabledAt: null,
  firstName: 'Owner',
  lastName: 'Test',
};
const w = '01900000-0000-7000-8000-0000000000aa';
const m = '01900000-0000-7000-8000-0000000000bb';

type CreateArgs = { data: Record<string, unknown> };

function setup(create = vi.fn<(args: CreateArgs) => Promise<unknown>>().mockResolvedValue({})) {
  const logger = { error: vi.fn(), setContext: vi.fn() };
  const audit = new AuditService({ auditLog: { create } } as never, logger as never);
  const data = (call: number) => create.mock.calls[call]?.[0].data;
  return { audit, create, logger, data };
}

function store(extra: Partial<RequestStore> = {}): RequestStore {
  return { requestId: 'r1', ip: '1.2.3.4', userAgent: 'UA', user, ...extra };
}

const inWorkspace = {
  workspace: { id: w, type: 'ORGANIZATION', status: 'ACTIVE' },
  membership: { id: m, role: 'OWNER', canTeach: false, status: 'ACTIVE' },
} as const;

describe('AuditService', () => {
  it('fills actor, ip, user agent and request id from the context and strips secrets', async () => {
    const { audit, create } = setup();
    await RequestContext.run(store(inWorkspace), () =>
      audit.log({
        action: 'member.role_changed',
        entityType: 'Membership',
        entityId: m,
        workspaceId: w,
        before: { role: 'TEACHER', passwordHash: 'x' },
        after: { role: 'ADMIN' },
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: user.id,
        actorRole: 'OWNER',
        ip: '1.2.3.4',
        userAgent: 'UA',
        requestId: 'r1',
        before: { role: 'TEACHER' },
      }),
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'member.role_changed',
        entityType: 'Membership',
        entityId: m,
        workspaceId: w,
        after: { role: 'ADMIN' },
      }),
    });
  });

  it('never stores hashes, secrets, passwords, tokens or other redacted keys, at any depth', async () => {
    const { audit, data } = setup();
    await RequestContext.run(store(), () =>
      audit.log({
        action: 'user.profile_updated',
        entityType: 'User',
        entityId: user.id,
        before: {
          firstName: 'A',
          password: 'pw',
          totpSecretEnc: 'v1.abc',
          refreshTokenHash: 'h',
          recoveryCodesHash: ['h1'],
          nested: { apiToken: 't', otpCode: '123456', recoveryCode: 'r', keep: 1 },
          list: [{ secret: 's', ok: true }],
        },
        after: { firstName: 'B', email: 'new@example.com', authorization: 'Bearer x' },
      }),
    );
    expect(data(0)?.before).toEqual({
      firstName: 'A',
      nested: { keep: 1 },
      list: [{ ok: true }],
    });
    // Emails are audited content (email change); the other redact keys are not.
    expect(data(0)?.after).toEqual({ firstName: 'B', email: 'new@example.com' });
  });

  it('uses the workspace from the context and the platform role outside a workspace', async () => {
    const { audit, data } = setup();
    await RequestContext.run(store(inWorkspace), () =>
      audit.log({ action: 'workspace.updated', entityType: 'Workspace', entityId: w }),
    );
    expect(data(0)).toMatchObject({ workspaceId: w, actorRole: 'OWNER' });

    await RequestContext.run(store(), () =>
      audit.log({ action: 'auth.login', entityType: 'User', entityId: user.id }),
    );
    expect(data(1)).toMatchObject({ workspaceId: null, actorRole: 'USER' });

    const admin: AuthUser = { ...user, platformRole: 'SUPER_ADMIN' };
    await RequestContext.run(store({ user: admin }), () =>
      audit.log({ action: 'user.suspended', entityType: 'User', entityId: user.id }),
    );
    expect(data(2)).toMatchObject({ actorRole: 'SUPER_ADMIN' });
  });

  it('does not use the membership role for another workspace', async () => {
    const { audit, data } = setup();
    const other = '01900000-0000-7000-8000-0000000000cc';
    await RequestContext.run(store(inWorkspace), () =>
      audit.log({
        action: 'workspace.created',
        entityType: 'Workspace',
        entityId: other,
        workspaceId: other,
      }),
    );
    expect(data(0)).toMatchObject({ workspaceId: other, actorRole: 'USER' });
  });

  it('honours actorOverride and records SYSTEM outside a request', async () => {
    const { audit, data } = setup();
    await RequestContext.run(store({ user: undefined }), () =>
      audit.log({
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user.id,
        actorOverride: { userId: user.id, role: 'USER' },
      }),
    );
    expect(data(0)).toMatchObject({ actorUserId: user.id, actorRole: 'USER', requestId: 'r1' });

    await audit.log({ action: 'workspace.deleted', entityType: 'Workspace', entityId: w });
    expect(data(1)).toMatchObject({
      actorUserId: null,
      actorRole: 'SYSTEM',
      ip: null,
      userAgent: null,
    });
    expect(data(1)?.requestId).toMatch(/^system-/);
  });

  it('records an anonymous request without an actor, and an empty ip as null', async () => {
    const { audit, data } = setup();
    await RequestContext.run(store({ user: undefined, ip: '', userAgent: '' }), () =>
      audit.log({ action: 'auth.password_reset_requested', entityType: 'User' }),
    );
    expect(data(0)).toMatchObject({
      actorUserId: null,
      actorRole: 'ANONYMOUS',
      ip: null,
      userAgent: null,
      entityId: null,
    });
  });

  it('never throws to the caller: a failed write is logged at error level', async () => {
    const { audit, logger } = setup(vi.fn().mockRejectedValue(new Error('db down')));
    await expect(
      RequestContext.run(store(), () =>
        audit.log({ action: 'auth.login', entityType: 'User', entityId: user.id }),
      ),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', err: expect.any(Error) }),
      expect.any(String),
    );
  });

  it('does not log the arguments a Prisma validation error message would carry', async () => {
    const err = new Prisma.PrismaClientValidationError('create({ data: { after: a@b.c } })', {
      clientVersion: 'x',
    });
    const { audit, logger } = setup(vi.fn().mockRejectedValue(err));
    await audit.log({
      action: 'auth.email_changed',
      entityType: 'User',
      after: { email: 'a@b.c' },
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('a@b.c');
  });
});
