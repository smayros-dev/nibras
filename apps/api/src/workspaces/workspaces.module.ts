import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { WorkspaceSettingsService } from './workspace-settings.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * Workspaces (PRD §8.2). Exports `WorkspacesService` for registration (PERSONAL workspace) and
 * `POST /me/personal-workspace`. Depends on the global `DbModule` and `AuditModule`.
 */
@Module({
  imports: [ProvidersModule],
  controllers: [WorkspacesController, AuditLogController],
  providers: [WorkspacesService, WorkspaceSettingsService, AuditLogService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
