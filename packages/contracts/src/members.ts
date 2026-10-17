import { z } from 'zod';
import { MEMBERSHIP_STATUSES } from './member-statuses';
import { MEMBERSHIP_ROLES } from './permissions';

export * from './member-statuses';

export const MEMBERS_PAGE_MAX = 100;
export const MEMBERS_PAGE_DEFAULT = 50;

/**
 * `GET /workspaces/{wid}/members` query (`workspace.members.read`):
 * - `role`, `status`: exact filters. Without `status`, memberships that are over (`REMOVED`,
 *   `REJECTED`) are left out;
 * - `q`: case-insensitive substring of the first name, last name or (scope `all` only) email;
 * - `cursor`: the previous page's `nextCursor` (opaque); `limit` 1–100, default 50.
 * Order: last name, first name, user id (stable).
 */
export const MembersQuerySchema = z.object({
  role: z.enum(MEMBERSHIP_ROLES).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(MEMBERS_PAGE_MAX).default(MEMBERS_PAGE_DEFAULT),
});

export type MembersQuery = z.infer<typeof MembersQuerySchema>;

/**
 * One member of the workspace. `email` is omitted when the caller reads with scope `own` (an
 * organisation TEACHER/ASSISTANT sees his own students, without their email). `joinedAt` is an
 * ISO string or `null` (not joined yet).
 */
export const MemberSummarySchema = z.object({
  userId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().optional(),
  role: z.enum(MEMBERSHIP_ROLES),
  canTeach: z.boolean(),
  status: z.enum(MEMBERSHIP_STATUSES),
  joinedAt: z.string().nullable(),
});

export type MemberSummary = z.infer<typeof MemberSummarySchema>;

/** `nextCursor` is `null` on the last page. */
export const MembersPageSchema = z.object({
  items: z.array(MemberSummarySchema),
  nextCursor: z.string().nullable(),
});

export type MembersPage = z.infer<typeof MembersPageSchema>;

/**
 * `PATCH /workspaces/{wid}/members/{uid}` (`workspace.staff.manage`): a role change only between
 * `ADMIN` and `TEACHER` (any other current or requested role → `422 ROLE_CHANGE_NOT_ALLOWED`);
 * `canTeach` applies to an `ADMIN` only (a `TEACHER` always has `canTeach = false`).
 */
export const UpdateMemberSchema = z
  .object({
    role: z.enum(MEMBERSHIP_ROLES).optional(),
    canTeach: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.canTeach !== undefined, {
    message: 'Expected role or canTeach',
  });

export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;

/** Optional body of `DELETE /workspaces/{wid}/members/{uid}`: why the member was removed. */
export const RemoveMemberSchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();

export type RemoveMemberInput = z.infer<typeof RemoveMemberSchema>;

export const ASSIGNMENTS_PAGE_MAX = 100;
export const ASSIGNMENTS_PAGE_DEFAULT = 50;

/**
 * `GET /workspaces/{wid}/assignments` query (`workspace.members.read`; with scope `own` only the
 * caller's own assignments, whatever `teacherUserId` says). Oldest first; `cursor` = the previous
 * page's `nextCursor`.
 */
export const AssignmentsQuerySchema = z.object({
  teacherUserId: z.uuid().optional(),
  studentUserId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(ASSIGNMENTS_PAGE_MAX).default(ASSIGNMENTS_PAGE_DEFAULT),
});

export type AssignmentsQuery = z.infer<typeof AssignmentsQuerySchema>;

/**
 * `POST /workspaces/{wid}/assignments` (`student.assign`): the teacher must be an ACTIVE `TEACHER`
 * (or `ADMIN`/`OWNER` with `canTeach`), the student an ACTIVE `STUDENT` of the workspace, else
 * `422 VALIDATION_FAILED`; an existing pair → `409 ALREADY_ASSIGNED`.
 */
export const CreateAssignmentSchema = z
  .object({ teacherUserId: z.uuid(), studentUserId: z.uuid() })
  .strict();

export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>;

/** A teacher ↔ student assignment (PRD §11.2). `createdAt` is an ISO string. */
export const AssignmentSchema = z.object({
  id: z.string(),
  teacherUserId: z.string(),
  studentUserId: z.string(),
  assignedByUserId: z.string(),
  createdAt: z.string(),
});

export type Assignment = z.infer<typeof AssignmentSchema>;

export const AssignmentsPageSchema = z.object({
  items: z.array(AssignmentSchema),
  nextCursor: z.string().nullable(),
});

export type AssignmentsPage = z.infer<typeof AssignmentsPageSchema>;
