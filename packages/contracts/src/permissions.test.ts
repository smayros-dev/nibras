import { describe, expect, it } from 'vitest';
import {
  MATRIX,
  MATRIX_ROLES,
  OWNER_ONLY,
  PERMISSIONS,
  PERSONAL_OWNER_OVERRIDES,
  grantFor,
  type Grant,
  type MembershipRole,
  type Permission,
  type WorkspaceType,
} from './permissions';

const g = (
  role: MembershipRole,
  p: Permission,
  workspaceType: WorkspaceType = 'ORGANIZATION',
  canTeach = false,
): Grant => grantFor({ role, canTeach, workspaceType }, p);

describe('§7 permission matrix', () => {
  it('AC-WS-03 at policy level: ADMIN without can_teach cannot create a course, with can_teach can', () => {
    expect(
      grantFor({ role: 'ADMIN', canTeach: false, workspaceType: 'ORGANIZATION' }, 'course.create'),
    ).toBe('none');
    expect(
      grantFor({ role: 'ADMIN', canTeach: true, workspaceType: 'ORGANIZATION' }, 'course.create'),
    ).toBe('all');
  });

  it('personal owner has teacher rights plus settings/audit/remove; org teacher has own-scoped rights', () => {
    expect(
      grantFor(
        { role: 'OWNER', canTeach: false, workspaceType: 'PERSONAL' },
        'workspace.settings.update',
      ),
    ).toBe('all');
    expect(
      grantFor(
        { role: 'TEACHER', canTeach: false, workspaceType: 'ORGANIZATION' },
        'workspace.settings.update',
      ),
    ).toBe('none');
    expect(
      grantFor(
        { role: 'TEACHER', canTeach: false, workspaceType: 'ORGANIZATION' },
        'session.manage',
      ),
    ).toBe('own');
    expect(
      grantFor({ role: 'STUDENT', canTeach: false, workspaceType: 'ORGANIZATION' }, 'abuse.report'),
    ).toBe('all');
    expect(
      grantFor({ role: 'OWNER', canTeach: false, workspaceType: 'PERSONAL' }, 'abuse.handle'),
    ).toBe('none');
    expect(
      grantFor(
        { role: 'ADMIN', canTeach: false, workspaceType: 'ORGANIZATION' },
        'workspace.delete',
      ),
    ).toBe('none');
    expect(
      grantFor(
        { role: 'OWNER', canTeach: false, workspaceType: 'ORGANIZATION' },
        'workspace.delete',
      ),
    ).toBe('all');
  });

  it('every Permission has a row and every row has the five columns', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PERMISSIONS].sort());
    expect(PERMISSIONS).toHaveLength(37);
    for (const p of PERMISSIONS) {
      expect(Object.keys(MATRIX[p]).sort()).toEqual([...MATRIX_ROLES].sort());
      for (const role of MATRIX_ROLES) expect(['all', 'own', 'none']).toContain(MATRIX[p][role]);
    }
  });

  it('pins the owner-only and personal-owner exception lists', () => {
    expect(OWNER_ONLY).toEqual(['workspace.delete', 'workspace.transfer']);
    expect(PERSONAL_OWNER_OVERRIDES).toEqual({
      'workspace.settings.update': 'all',
      'workspace.audit.read': 'all',
      'student.remove': 'all',
      'abuse.handle': 'none',
    });
  });

  it('organisation OWNER = ADMIN column plus the owner-only rights', () => {
    for (const p of PERMISSIONS) {
      const expected = OWNER_ONLY.includes(p) ? 'all' : g('ADMIN', p);
      expect(g('OWNER', p), p).toBe(expected);
    }
    expect(g('OWNER', 'workspace.transfer')).toBe('all');
    expect(g('ADMIN', 'workspace.transfer')).toBe('none');
    // An organisation OWNER is an ADMIN without can_teach unless the flag is set.
    expect(g('OWNER', 'course.create')).toBe('none');
    expect(
      grantFor({ role: 'OWNER', canTeach: true, workspaceType: 'ORGANIZATION' }, 'course.create'),
    ).toBe('all');
  });

  it('personal OWNER = TEACHER column with the personal overrides and the owner-only rights', () => {
    expect(g('OWNER', 'course.create', 'PERSONAL')).toBe('all');
    expect(g('OWNER', 'course.manage', 'PERSONAL')).toBe('own');
    expect(g('OWNER', 'student.remove', 'PERSONAL')).toBe('all');
    expect(g('OWNER', 'workspace.audit.read', 'PERSONAL')).toBe('all');
    expect(g('OWNER', 'workspace.staff.manage', 'PERSONAL')).toBe('none');
    expect(g('OWNER', 'student.assign', 'PERSONAL')).toBe('none');
    // §7 "OWNER seul" sits in the TEACHER (or personal OWNER) column too.
    expect(g('OWNER', 'workspace.delete', 'PERSONAL')).toBe('all');
    expect(g('OWNER', 'workspace.transfer', 'PERSONAL')).toBe('all');
    // A TEACHER in a personal workspace (not the owner) gets no override.
    expect(g('TEACHER', 'workspace.settings.update', 'PERSONAL')).toBe('none');
    expect(g('TEACHER', 'workspace.delete', 'PERSONAL')).toBe('none');
  });

  it('ADMIN with can_teach takes the best of both columns per cell', () => {
    expect(g('ADMIN', 'room.open')).toBe('none');
    expect(g('ADMIN', 'room.open', 'ORGANIZATION', true)).toBe('own');
    expect(g('ADMIN', 'report.write', 'ORGANIZATION', true)).toBe('own');
    expect(g('ADMIN', 'room.moderate', 'ORGANIZATION', true)).toBe('own');
    expect(g('ADMIN', 'course.manage', 'ORGANIZATION', true)).toBe('all');
    expect(g('ADMIN', 'dashboard.teacher')).toBe('none');
    expect(g('ADMIN', 'dashboard.teacher', 'ORGANIZATION', true)).toBe('all');
    expect(g('ADMIN', 'report.private_notes.read')).toBe('none');
  });

  it('transcribes P1 cells as none and the remaining roles from their columns', () => {
    expect(g('ADMIN', 'room.join')).toBe('none'); // 👁 (observateur, P1)
    expect(g('ASSISTANT', 'course.media.manage')).toBe('none'); // 🔒 (P1)
    expect(g('ASSISTANT', 'report.write')).toBe('none'); // 🔒 (brouillon, P1)
    expect(g('GUARDIAN', 'message.direct')).toBe('none'); // ✅ (…, P1)
    expect(g('STUDENT', 'session.manage')).toBe('none'); // ❌ (réserver : P1)
    expect(g('STUDENT', 'room.join')).toBe('all');
    expect(g('GUARDIAN', 'progress.read')).toBe('all');
    expect(g('GUARDIAN', 'course.read')).toBe('none');
    expect(g('TEACHER', 'report.private_notes.read')).toBe('own');
    expect(g('STUDENT', 'attendance.override')).toBe('none');
    for (const role of ['OWNER', 'ADMIN', 'TEACHER', 'ASSISTANT', 'STUDENT', 'GUARDIAN'] as const) {
      expect(g(role, 'account.export')).toBe('all');
      expect(g(role, 'account.delete')).toBe('all');
      expect(g(role, 'abuse.report')).toBe('all');
    }
  });
});
