/**
 * Prisma models that carry a mandatory `workspaceId` (PRD §11 tables marked 🏢). Every query on
 * them must run in a tenant context. Later sub-projects append their tenant models here.
 */
export const TENANT_MODELS = ['Membership', 'TeacherStudentAssignment', 'TeacherProfile'] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];
