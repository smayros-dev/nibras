import { Module } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { WorkspaceContextGuard } from './workspace-context.guard';

/**
 * The tenancy guards as providers. `AppModule` registers them as global guards
 * (`APP_GUARD` + `useExisting`) in the order JwtAuth → AccountGates → SuperAdmin →
 * WorkspaceContext → Permission → TeacherVerified. Depends on the global `DbModule` and
 * `AuditModule`.
 */
@Module({
  providers: [SuperAdminGuard, WorkspaceContextGuard, PermissionGuard],
  exports: [SuperAdminGuard, WorkspaceContextGuard, PermissionGuard],
})
export class TenancyModule {}
