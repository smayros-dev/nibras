/**
 * Prisma models that carry a mandatory `workspaceId` (PRD §11 tables marked 🏢). Every query on
 * them must run in a tenant context. Later sub-projects append their tenant models here.
 */
export const TENANT_MODELS = [
  'Membership',
  'TeacherStudentAssignment',
  'TeacherProfile',
  // SP2 (students & invitations).
  'Invitation',
  'InviteLink',
  'GuardianLink',
  'InvitationImport',
] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];

/**
 * Models whose `workspaceId` is nullable: NULL rows are account-level (visible without a tenant
 * context), non-NULL rows belong to that workspace (D-O5 guardian/recording/AI/WhatsApp consents).
 * RLS policy: `workspace_id IS NULL OR workspace_id = app.workspace_id OR bypass`.
 */
export const NULLABLE_TENANT_MODELS = ['Consent'] as const;

export type NullableTenantModel = (typeof NULLABLE_TENANT_MODELS)[number];
