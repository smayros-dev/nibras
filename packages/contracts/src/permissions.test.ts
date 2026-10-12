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
      'workspace.members.read': 'all',
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
    // Not a §7 row: a personal owner sees every member; an org TEACHER only his own students.
    expect(g('OWNER', 'workspace.members.read', 'PERSONAL')).toBe('all');
    expect(g('TEACHER', 'workspace.members.read')).toBe('own');
    expect(g('TEACHER', 'workspace.members.read', 'PERSONAL')).toBe('own');
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
    // "✅ (le sien si can_teach)" → own; max(own, TEACHER own) stays own.
    expect(g('ADMIN', 'dashboard.teacher', 'ORGANIZATION', true)).toBe('own');
    expect(g('OWNER', 'dashboard.teacher', 'ORGANIZATION', true)).toBe('own');
    expect(g('ADMIN', 'report.private_notes.read')).toBe('none');
  });

  it('transcribes P1 cells as none and the remaining roles from their columns', () => {
    expect(g('ADMIN', 'room.join')).toBe('none'); // 👁 (observateur, P1)
    expect(g('ASSISTANT', 'course.media.manage')).toBe('none'); // 🔒 (P1)
    expect(g('ASSISTANT', 'report.write')).toBe('none'); // 🔒 (brouillon, P1)
    expect(g('GUARDIAN', 'message.direct')).toBe('none'); // ✅ (…, P1)
    expect(g('STUDENT', 'session.manage')).toBe('none'); // ❌ (réserver : P1)
    expect(g('STUDENT', 'room.join')).toBe('all');
    expect(g('GUARDIAN', 'course.read')).toBe('none');
    expect(g('TEACHER', 'report.private_notes.read')).toBe('own');
    expect(g('STUDENT', 'attendance.override')).toBe('none');
    for (const role of ['OWNER', 'ADMIN', 'TEACHER', 'ASSISTANT', 'STUDENT', 'GUARDIAN'] as const) {
      expect(g(role, 'account.export')).toBe('all');
      expect(g(role, 'account.delete')).toBe('all');
      expect(g(role, 'abuse.report')).toBe('all');
    }
  });

  it('maps self/child-qualified cells ("le sien", "la sienne", "ses enfants") to own', () => {
    // STUDENT "le sien" / "la sienne".
    for (const p of [
      'student.read',
      'student.update',
      'progress.read',
      'calendar.read',
      'session.history.read',
      'attendance.read',
      'report.read',
    ] as const) {
      expect(g('STUDENT', p), p).toBe('own');
    }
    // GUARDIAN "ses enfants".
    for (const p of [
      'student.read',
      'progress.read',
      'calendar.read',
      'session.history.read',
      'report.read',
    ] as const) {
      expect(g('GUARDIAN', p), p).toBe('own');
    }
    // Enrollment / condition qualifiers stay all; the unqualified guardian 👁 on attendance too.
    expect(g('STUDENT', 'course.read')).toBe('all'); // si inscrit et publié
    expect(g('STUDENT', 'pdf.download')).toBe('all'); // si allow_download
    expect(g('STUDENT', 'room.join')).toBe('all'); // si participant
    expect(g('GUARDIAN', 'attendance.read')).toBe('all'); // 👁
  });
});
