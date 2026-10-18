import { resetDatabase, systemPrisma } from '@nibras/db';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createOrganization,
  createPersonalWorkspace,
  createUser,
} from '../../test/helpers/factories';
import { requiresTwoFactor } from './two-factor.policy';

describe('requiresTwoFactor (PRD D-P12)', () => {
  beforeEach(() => resetDatabase(systemPrisma()));

  it('SUPER_ADMIN → true, even without any membership', async () => {
    const admin = await createUser({ platformRole: 'SUPER_ADMIN' });
    expect(await requiresTwoFactor(admin)).toBe(true);
  });

  it('OWNER of a PERSONAL workspace → false', async () => {
    const teacher = await createUser();
    await createPersonalWorkspace(teacher);
    expect(await requiresTwoFactor(teacher)).toBe(false);
  });

  it('ORGANIZATION OWNER and ADMIN → true; TEACHER and STUDENT → false', async () => {
    const [owner, admin, teacher, student] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ]);
    await createOrganization({ owner, admins: [admin], teachers: [teacher], students: [student] });
    expect(await requiresTwoFactor(owner)).toBe(true);
    expect(await requiresTwoFactor(admin)).toBe(true);
    expect(await requiresTwoFactor(teacher)).toBe(false);
    expect(await requiresTwoFactor(student)).toBe(false);
  });

  it('a REMOVED admin membership → false', async () => {
    const owner = await createUser();
    const admin = await createUser();
    const { memberships } = await createOrganization({ owner, admins: [admin] });
    await systemPrisma().membership.update({
      where: { id: memberships[1]!.id },
      data: { status: 'REMOVED' },
    });
    expect(await requiresTwoFactor(admin)).toBe(false);
  });
});
