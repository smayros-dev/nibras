import { z } from 'zod';
import { INVITE_LINK_STATUSES } from './invite-constants';
import {
  AcceptJoinModeSchema,
  AcceptRegisterSchema,
  InviteEmailSchema,
  PersonNameSchema,
  WorkspaceRefSchema,
} from './invitations';

const LabelSchema = z.string().trim().max(80);
const MaxUsesSchema = z.number().int().min(1).max(1000);

/**
 * `POST /workspaces/{wid}/invite-links` (`student.invite`, verified teacher): a group code for
 * `STUDENT`s. Defaults: no approval, `INVITE_LINK_DEFAULT_MAX_USES` uses,
 * `INVITE_LINK_DEFAULT_TTL_DAYS` days; `expiresAt` at most one year ahead (checked by the service).
 */
export const CreateInviteLinkSchema = z
  .object({
    label: LabelSchema.optional(),
    requiresApproval: z.boolean().optional(),
    maxUses: MaxUsesSchema.optional(),
    expiresAt: z.iso.datetime().optional(),
    courseIds: z.array(z.uuid()).max(50).default([]),
    teacherUserId: z.uuid().optional(),
  })
  .strict();

export type CreateInviteLinkInput = z.infer<typeof CreateInviteLinkSchema>;

/** `PATCH /workspaces/{wid}/invite-links/{id}`: at least one key; `expiresAt: null` = no expiry. */
export const UpdateInviteLinkSchema = z
  .object({
    label: LabelSchema.optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    maxUses: MaxUsesSchema.optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
    requiresApproval: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Expected at least one field',
  });

export type UpdateInviteLinkInput = z.infer<typeof UpdateInviteLinkSchema>;

/** An invite link as the staff sees it. `status` is derived; `url` is the public join page. */
export const InviteLinkSchema = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string().nullable(),
  requiresApproval: z.boolean(),
  maxUses: z.number().int(),
  usesCount: z.number().int(),
  expiresAt: z.string().nullable(),
  status: z.enum(INVITE_LINK_STATUSES),
  createdByUserId: z.string(),
  teacherUserId: z.string().nullable(),
  courseIds: z.array(z.string()),
  createdAt: z.string(),
  url: z.string(),
});

export type InviteLink = z.infer<typeof InviteLinkSchema>;

/** A code is not bound to an address: the viewer is only signed in or not. */
export const JOIN_VIEWERS = ['ANONYMOUS', 'SIGNED_IN'] as const;

/** Public `GET /join/{code}`. `accountRequired`: the viewer is anonymous (sign in or register). */
export const JoinPreviewSchema = z.object({
  workspace: WorkspaceRefSchema,
  teacher: PersonNameSchema,
  requiresApproval: z.boolean(),
  viewer: z.enum(JOIN_VIEWERS),
  accountRequired: z.boolean(),
});

export type JoinPreview = z.infer<typeof JoinPreviewSchema>;

/** Public `POST /join/{code}/accept`: like an invitation, plus the email on `REGISTER`. */
export const AcceptJoinSchema = z.discriminatedUnion('mode', [
  AcceptRegisterSchema.extend({ email: InviteEmailSchema }),
  AcceptJoinModeSchema,
]);

export type AcceptJoinInput = z.infer<typeof AcceptJoinSchema>;
