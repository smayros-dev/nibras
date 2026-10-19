import { z } from 'zod';
import { BirthDateSchema, MeUserSchema, TimezoneSchema } from './auth';
import { INVITABLE_ROLES, INVITATION_STATUSES } from './invite-constants';
import { LocaleSchema } from './locale';
import { MEMBERSHIP_STATUSES } from './member-statuses';
import { MEMBERSHIP_ROLES } from './permissions';

/** Email identity is case-insensitive: trimmed and lower-cased everywhere (as at registration). */
export const InviteEmailSchema = z.string().trim().toLowerCase().email().max(254);
const NameSchema = z.string().trim().min(1).max(80);
const CourseIdsSchema = z.array(z.uuid()).max(50).default([]);

export const INVITATIONS_PAGE_MAX = 100;
export const INVITATIONS_PAGE_DEFAULT = 50;

/**
 * `POST /workspaces/{wid}/invitations` (`student.invite`, verified teacher). `TEACHER` / `ADMIN`
 * rows additionally need `workspace.staff.manage` with scope `all` in an organisation (else
 * `422 INVITATION_ROLE_NOT_ALLOWED`). `courseIds` are assigned at acceptance (SP3);
 * `teacherUserId` (organisation) assigns the student to that teacher at acceptance.
 */
export const CreateInvitationSchema = z
  .object({
    email: InviteEmailSchema,
    role: z.enum(INVITABLE_ROLES).default('STUDENT'),
    firstName: NameSchema.optional(),
    lastName: NameSchema.optional(),
    guardianEmail: InviteEmailSchema.optional(),
    birthDate: BirthDateSchema.optional(),
    message: z.string().trim().max(500).optional(),
    courseIds: CourseIdsSchema,
    teacherUserId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => v.guardianEmail === undefined || v.guardianEmail !== v.email, {
    message: 'The guardian email must differ from the invited email',
    path: ['guardianEmail'],
  });

export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;

/** `PATCH /workspaces/{wid}/invitations/{id}`: a `PENDING` invitation only; `null` clears. */
export const UpdateInvitationSchema = z
  .object({
    firstName: NameSchema.optional(),
    lastName: NameSchema.optional(),
    guardianEmail: InviteEmailSchema.nullable().optional(),
    message: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export type UpdateInvitationInput = z.infer<typeof UpdateInvitationSchema>;

/**
 * `GET /workspaces/{wid}/invitations` query: `status` filters on the derived status, `q` is a
 * case-insensitive substring of the email or names. Newest first (`createdAt desc, id desc`);
 * `cursor` = the previous page's `nextCursor` (an invitation id).
 */
export const InvitationsQuerySchema = z.object({
  status: z.enum(INVITATION_STATUSES).optional(),
  role: z.enum(INVITABLE_ROLES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(INVITATIONS_PAGE_MAX).default(INVITATIONS_PAGE_DEFAULT),
});

export type InvitationsQuery = z.infer<typeof InvitationsQuerySchema>;

/** One invitation as the workspace staff sees it. `status` is derived; dates are ISO strings. */
export const InvitationSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(INVITABLE_ROLES),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  guardianEmail: z.string().nullable(),
  status: z.enum(INVITATION_STATUSES),
  expiresAt: z.string(),
  invitedByUserId: z.string(),
  invitedByName: z.string(),
  teacherUserId: z.string().nullable(),
  courseIds: z.array(z.string()),
  resentCount: z.number().int(),
  lastSentAt: z.string(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type InvitationSummary = z.infer<typeof InvitationSummarySchema>;

/** `nextCursor` is `null` on the last page. */
export const InvitationsPageSchema = z.object({
  items: z.array(InvitationSummarySchema),
  nextCursor: z.string().nullable(),
});

export type InvitationsPage = z.infer<typeof InvitationsPageSchema>;

export const WorkspaceRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['PERSONAL', 'ORGANIZATION']),
});

export type WorkspaceRef = z.infer<typeof WorkspaceRefSchema>;

export const PersonNameSchema = z.object({ firstName: z.string(), lastName: z.string() });

/** The signed-in user against the invited address: none, the same email, another email. */
export const INVITATION_VIEWERS = ['ANONYMOUS', 'MATCH', 'MISMATCH'] as const;

/**
 * Public `GET /invitations/{token}`: what the invitation page shows. The address is masked;
 * `requiresBirthDate`: a STUDENT invitation with no known birth date; `guardianEmailPrefilled`:
 * the inviter already gave a guardian email.
 */
export const InvitationPreviewSchema = z.object({
  workspace: WorkspaceRefSchema,
  inviter: PersonNameSchema,
  role: z.enum(INVITABLE_ROLES),
  emailMasked: z.string(),
  accountExists: z.boolean(),
  viewer: z.enum(INVITATION_VIEWERS),
  requiresBirthDate: z.boolean(),
  guardianEmailPrefilled: z.boolean(),
  expiresAt: z.string(),
  message: z.string().nullable(),
});

export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

/** `REGISTER` (no account yet) body of an acceptance; the invitation supplies the email. */
export const AcceptRegisterSchema = z
  .object({
    mode: z.literal('REGISTER'),
    firstName: NameSchema,
    lastName: NameSchema,
    password: z.string().min(12).max(256),
    locale: LocaleSchema,
    timezone: TimezoneSchema,
    birthDate: BirthDateSchema.optional(),
    guardianEmail: InviteEmailSchema.optional(),
    acceptTerms: z.literal(true),
    acceptPrivacy: z.literal(true),
  })
  .strict();

/** `JOIN` (signed in) body of an acceptance. */
export const AcceptJoinModeSchema = z
  .object({
    mode: z.literal('JOIN'),
    birthDate: BirthDateSchema.optional(),
    guardianEmail: InviteEmailSchema.optional(),
  })
  .strict();

/**
 * Public `POST /invitations/{token}/accept`: `REGISTER` creates the account (the address is the
 * invited one, marked verified), `JOIN` adds the signed-in user (same address only).
 */
export const AcceptInvitationSchema = z.discriminatedUnion('mode', [
  AcceptRegisterSchema,
  AcceptJoinModeSchema,
]);

export type AcceptInvitationInput = z.infer<typeof AcceptInvitationSchema>;

/** `201` of an acceptance: the session cookies are set; `membershipStatus` may be pending. */
export const AcceptResultSchema = z.object({
  user: MeUserSchema,
  workspace: WorkspaceRefSchema,
  membershipStatus: z.enum(MEMBERSHIP_STATUSES),
  role: z.enum(MEMBERSHIP_ROLES),
});

export type AcceptResult = z.infer<typeof AcceptResultSchema>;
