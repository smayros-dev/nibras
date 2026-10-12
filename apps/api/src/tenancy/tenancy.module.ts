import { Module } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { WorkspaceContextGuard } from './workspace-context.guard';

/**
 * The tenancy guards as providers. `AppModule` registers them as global guards
 * (`APP_GUARD` + `useExisting`) in the order JwtAuth → AccountGates → WorkspaceContext →
 * Permission → TeacherVerified. Depends on the global `DbModule` and `AuditModule`.
 */
@Module({
  providers: [WorkspaceContextGuard, PermissionGuard],
  exports: [WorkspaceContextGuard, PermissionGuard],
})
export class TenancyModule {}
