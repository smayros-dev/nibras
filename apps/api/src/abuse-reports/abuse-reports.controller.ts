import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  AbuseReport,
  AbuseReportCreated,
  AbuseReportsPage,
  MyAbuseReportsPage,
} from '@tt/contracts';
import { CurrentUser } from '../auth/decorators/current-user';
import type { AuthUser } from '../common/request-context';
import { CrossTenant, RequirePermission, SuperAdminOnly } from '../tenancy/decorators';
import { AbuseReportsService } from './abuse-reports.service';
import {
  AbuseReportsQueryDto,
  AdminAbuseReportsQueryDto,
  CreateAbuseReportDto,
  MyAbuseReportsQueryDto,
  UpdateAbuseReportDto,
} from './dto';

/**
 * An organisation's abuse reports (PRD §8.16, §15 "Signalements"). Behind
 * `WorkspaceContextGuard`: a non-member of `:wid` gets 404, a SUSPENDED/DELETING workspace
 * refuses the mutations (423). Only reports of `:wid` exist here: another workspace's report id
 * is 404, and so is a report about the caller himself.
 */
@Controller('workspaces/:wid/abuse-reports')
export class WorkspaceAbuseReportsController {
  constructor(private readonly reports: AbuseReportsService) {}

  /**
   * Any member (`abuse.report`): `201 { id, status: 'OPEN' }`. The entity must exist in this
   * workspace (`404`); an entity type without a snapshot provider → `422 ENTITY_TYPE_UNSUPPORTED`.
   * The reporter gets an acknowledgement; the handlers are notified by email.
   */
  @Post()
  @RequirePermission('abuse.report')
  create(
    @CurrentUser() user: AuthUser,
    @Param('wid') wid: string,
    @Body() body: CreateAbuseReportDto,
  ): Promise<AbuseReportCreated> {
    return this.reports.create(user, { ...body, workspaceId: wid });
  }

  /**
   * Organisation OWNER/ADMIN (`abuse.handle`; never the owner of a personal workspace): the
   * workspace's reports with reporter and frozen snapshot, newest first.
   */
  @Get()
  @RequirePermission('abuse.handle')
  list(
    @CurrentUser() user: AuthUser,
    @Param('wid') wid: string,
    @Query() query: AbuseReportsQueryDto,
  ): Promise<AbuseReportsPage> {
    return this.reports.list({ kind: 'workspace', workspaceId: wid, userId: user.id }, query);
  }

  @Get(':id')
  @RequirePermission('abuse.handle')
  get(
    @CurrentUser() user: AuthUser,
    @Param('wid') wid: string,
    @Param('id') id: string,
  ): Promise<AbuseReport> {
    return this.reports.get({ kind: 'workspace', workspaceId: wid, userId: user.id }, id);
  }

  /** Status / resolution / assignee (an ACTIVE OWNER/ADMIN). Audited `abuse_report.updated`. */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('abuse.handle')
  update(
    @CurrentUser() user: AuthUser,
    @Param('wid') wid: string,
    @Param('id') id: string,
    @Body() body: UpdateAbuseReportDto,
  ): Promise<AbuseReport> {
    return this.reports.update({ kind: 'workspace', workspaceId: wid, userId: user.id }, id, body);
  }
}

/** Reports outside any workspace (a profile) and the caller's own reports. */
@Controller()
export class AccountAbuseReportsController {
  constructor(private readonly reports: AbuseReportsService) {}

  /**
   * Any signed-in user, `entityType` `USER` only (`422 ENTITY_TYPE_UNSUPPORTED` otherwise):
   * `201 { id, status }`. Handled by the super-admin only.
   */
  @Post('abuse-reports')
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateAbuseReportDto,
  ): Promise<AbuseReportCreated> {
    return this.reports.create(user, { ...body, workspaceId: null });
  }

  /** The caller's own reports (any workspace), newest first, without snapshot or description. */
  @Get('me/abuse-reports')
  @CrossTenant()
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: MyAbuseReportsQueryDto,
  ): Promise<MyAbuseReportsPage> {
    return this.reports.listMine(user.id, query);
  }
}

/**
 * The super-admin abuse queue (PRD §8.17): every report of the platform, MINOR_SAFETY ones
 * whatever an organisation did with them (AC-SAFE-05). Non super-admins → `403`.
 */
@Controller('admin/abuse-reports')
@SuperAdminOnly()
@CrossTenant()
export class AdminAbuseReportsController {
  constructor(private readonly reports: AbuseReportsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminAbuseReportsQueryDto,
  ): Promise<AbuseReportsPage> {
    return this.reports.list({ kind: 'admin', userId: user.id }, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AbuseReport> {
    return this.reports.get({ kind: 'admin', userId: user.id }, id);
  }

  /** Status / resolution / assignee (an org OWNER/ADMIN or a super-admin). Audited. */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateAbuseReportDto,
  ): Promise<AbuseReport> {
    return this.reports.update({ kind: 'admin', userId: user.id }, id, body);
  }
}
