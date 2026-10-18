import { Controller, Get, Param, Query } from '@nestjs/common';
import type { AuditLogPage } from '@nibras/contracts';
import { RequirePermission } from '../tenancy/decorators';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './dto';

/** `GET /workspaces/{wid}/audit-log` (PRD §8.16.3): OWNER/ADMIN, or the personal owner. */
@Controller('workspaces/:wid/audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  /**
   * This workspace's entries only, newest first, filtered by `action`, `actorUserId`, `from`/`to`;
   * `limit` 1–100 (default 50), `cursor` = the previous page's `nextCursor`.
   */
  @Get()
  @RequirePermission('workspace.audit.read')
  list(@Param('wid') wid: string, @Query() query: AuditLogQueryDto): Promise<AuditLogPage> {
    return this.auditLog.list(wid, query);
  }
}
