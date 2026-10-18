import { CONSENT_VERSIONS, REQUIRED_CONSENTS } from '@nibras/contracts';
import { db, resetDatabase, systemPrisma } from '@nibras/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakePwnedClient } from '../auth/crypto/hibp';
import { verifyPassword } from '../auth/crypto/password';
import { PasswordPolicy } from '../auth/crypto/password-policy';
import { createSuperAdmin, parseCreateSuperAdminArgs } from './create-super-admin';

const PASSWORD = 'a long and unusual admin passphrase';
const policy = new PasswordPolicy(new FakePwnedClient());

describe('createSuperAdmin (first-admin bootstrap CLI)', () => {
  beforeEach(() => resetDatabase());

  it('creates a verified SUPER_ADMIN with an argon2 hash and the required consents', async () => {
    const result = await createSuperAdmin(
      db,
      { email: 'Root@Example.com', password: PASSWORD, firstName: 'Amel', lastName: 'Ben Ali' },
      policy,
    );
    expect(result.created).toBe(true);
    const user = await systemPrisma().user.findUniqueOrThrow({
      where: { email: 'root@example.com' },
    });
    expect(user).toMatchObject({
      id: result.userId,
      platformRole: 'SUPER_ADMIN',
      status: 'ACTIVE',
      firstName: 'Amel',
      lastName: 'Ben Ali',
      emailVerifiedAt: expect.any(Date),
      totpEnabledAt: null,
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(user.passwordHash!, PASSWORD)).toBe(true);
    const consents = await systemPrisma().consent.findMany({
      where: { userId: user.id, workspaceId: null, granted: true, revokedAt: null },
      select: { type: true, version: true },
      orderBy: { type: 'asc' },
    });
    expect(consents).toEqual(
      REQUIRED_CONSENTS.map((type) => ({ type, version: CONSENT_VERSIONS[type] })),
    );
    expect(
      await systemPrisma().auditLog.findFirst({
        where: { action: 'user.super_admin_granted', entityId: user.id },
      }),
    ).toMatchObject({ actorRole: 'SYSTEM', actorUserId: null, after: { created: true } });
    // No password material in the audit trail.
    const audit = await systemPrisma().auditLog.findMany({ where: { entityId: user.id } });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    expect(JSON.stringify(audit)).not.toContain('argon2');
  });

  it('running twice promotes rather than duplicating; an existing user is promoted', async () => {
    const input = { email: 'root@example.com', password: PASSWORD };
    const first = await createSuperAdmin(db, input, policy);
    const second = await createSuperAdmin(db, input, policy);
    expect(second).toEqual({ userId: first.userId, created: false });
    expect(await systemPrisma().user.count()).toBe(1);
    expect(await systemPrisma().consent.count({ where: { userId: first.userId } })).toBe(
      REQUIRED_CONSENTS.length,
    );

    const existing = await systemPrisma().user.create({
      data: { email: 'teacher@example.com', firstName: 'T', lastName: 'U', passwordHash: 'x' },
    });
    const promoted = await createSuperAdmin(
      db,
      { email: 'teacher@example.com', password: PASSWORD },
      policy,
    );
    expect(promoted).toEqual({ userId: existing.id, created: false });
    const after = await systemPrisma().user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after).toMatchObject({
      platformRole: 'SUPER_ADMIN',
      emailVerifiedAt: expect.any(Date),
      // The existing password is kept: promotion never rewrites credentials.
      passwordHash: 'x',
      firstName: 'T',
    });
  });

  it('applies the password policy on creation and refuses a non-active account', async () => {
    await expect(
      createSuperAdmin(db, { email: 'a@example.com', password: 'short' }, policy),
    ).rejects.toThrow(/PASSWORD_TOO_SHORT/);
    await expect(
      createSuperAdmin(db, { email: 'a@example.com', password: 'password1234' }, policy),
    ).rejects.toThrow(/PASSWORD_TOO_COMMON/);
    await expect(
      createSuperAdmin(db, { email: 'nope', password: PASSWORD }, policy),
    ).rejects.toThrow(/email/i);
    expect(await systemPrisma().user.count()).toBe(0);
    await systemPrisma().user.create({
      data: { email: 'gone@example.com', firstName: 'G', lastName: 'O', status: 'SUSPENDED' },
    });
    await expect(
      createSuperAdmin(db, { email: 'gone@example.com', password: PASSWORD }, policy),
    ).rejects.toThrow(/SUSPENDED/);
  });

  it('parses the command line', () => {
    expect(
      parseCreateSuperAdminArgs([
        'create-super-admin',
        '--email',
        'root@example.com',
        '--password',
        PASSWORD,
        '--first-name',
        'Amel',
      ]),
    ).toEqual({ email: 'root@example.com', password: PASSWORD, firstName: 'Amel' });
    expect(() => parseCreateSuperAdminArgs(['create-super-admin', '--email', 'x'])).toThrow(
      /--password/,
    );
    expect(() => parseCreateSuperAdminArgs(['other'])).toThrow(/create-super-admin/);
    expect(() =>
      parseCreateSuperAdminArgs(['create-super-admin', '--email', 'a', '--password', 'b', '--x']),
    ).toThrow(/--x/);
  });
});
