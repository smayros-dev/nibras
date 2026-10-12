import { describe, expect, it } from 'vitest';
import {
  AssignmentsQuerySchema,
  CreateAssignmentSchema,
  MembersQuerySchema,
  RemoveMemberSchema,
  UpdateMemberSchema,
} from './members';

describe('member inputs', () => {
  it('members query: limit coerced, 1–100, default 50; q trimmed; enums checked', () => {
    expect(MembersQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(MembersQuerySchema.parse({ limit: '100', q: '  ali ', role: 'STUDENT' })).toEqual({
      limit: 100,
      q: 'ali',
      role: 'STUDENT',
    });
    expect(MembersQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(MembersQuerySchema.safeParse({ role: 'KING' }).success).toBe(false);
    expect(MembersQuerySchema.safeParse({ status: 'GONE' }).success).toBe(false);
  });

  it('update: role or canTeach required, unknown keys refused', () => {
    expect(UpdateMemberSchema.parse({ role: 'ADMIN' })).toEqual({ role: 'ADMIN' });
    expect(UpdateMemberSchema.parse({ canTeach: true })).toEqual({ canTeach: true });
    expect(UpdateMemberSchema.safeParse({}).success).toBe(false);
    expect(UpdateMemberSchema.safeParse({ role: 'ADMIN', status: 'ACTIVE' }).success).toBe(false);
  });

  it('remove: optional trimmed reason', () => {
    expect(RemoveMemberSchema.parse({})).toEqual({});
    expect(RemoveMemberSchema.parse({ reason: ' left ' })).toEqual({ reason: 'left' });
    expect(RemoveMemberSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('assignments: uuids only', () => {
    expect(
      CreateAssignmentSchema.safeParse({ teacherUserId: 'x', studentUserId: 'y' }).success,
    ).toBe(false);
    expect(AssignmentsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(AssignmentsQuerySchema.safeParse({ teacherUserId: 'x' }).success).toBe(false);
  });
});
