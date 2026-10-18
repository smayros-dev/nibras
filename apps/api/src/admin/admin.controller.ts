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
import type { AdminHealth, AdminWorkspacesPage, WorkspaceStorage } from '@nibras/contracts';
import { CurrentUser } from '../auth/decorators/current-user';
import type { AuthUser } from '../common/request-context';
import { CrossTenant, SuperAdminOnly } from '../tenancy/decorators';
import { AdminService } from './admin.service';
import { AdminWorkspacesQueryDto, SuspensionDto, UpdateWorkspaceQuotaDto } from './dto';
import { UserSuspensionService } from './user-suspension.service';

/**
 * Super-admin console (PRD §8.16.4): `platformRole SUPER_ADMIN` only (`SuperAdminGuard`, else
 * `403 PERMISSION_DENIED`), after the account gates (2FA mandatory). The `:wid` routes here are
 * not tenant routes: no membership is needed and a suspended workspace is still administrable.
 * The abuse queue lives in the abuse-reports module (`/admin/abuse-reports`).
 */
@Controller('admin')
@SuperAdminOnly()
@CrossTenant()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly users: UserSuspensionService,
  ) {}

  /** US-X01: every workspace with its type, status, ACTIVE member count, storage and creation. */
  @Get('workspaces')
  listWorkspaces(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminWorkspacesQueryDto,
  ): Promise<AdminWorkspacesPage> {
    return this.admin.listWorkspaces(user, query);
  }

  /** `204`: read-only for its members with the reason (`423` on mutations). Idempotent. */
  @Post('workspaces/:wid/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async suspendWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('wid') wid: string,
    @Body() body: SuspensionDto,
  ): Promise<void> {
    await this.admin.suspendWorkspace(user, wid, body.reason);
  }

  /** `204`: back to ACTIVE. Idempotent. */
  @Post('workspaces/:wid/unsuspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsuspendWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('wid') wid: string,
  ): Promise<void> {
    await this.admin.unsuspendWorkspace(user, wid);
  }

  /** US-X03: `200` with the new quota and the usage (decimal strings). */
  @Patch('workspaces/:wid/quota')
  @HttpCode(HttpStatus.OK)
  updateQuota(
    @CurrentUser() user: AuthUser,
    @Param('wid') wid: string,
    @Body() body: UpdateWorkspaceQuotaDto,
  ): Promise<WorkspaceStorage> {
    return this.admin.updateQuota(user, wid, body);
  }

  /**
   * `204`: sessions revoked, login refused, personal workspaces read-only, email, audit,
   * `UserSuspendedEvent` (AC-SAFE-04). A super-admin → `409 CANNOT_SUSPEND_SUPER_ADMIN`.
   */
  @Post('users/:uid/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async suspendUser(
    @CurrentUser() user: AuthUser,
    @Param('uid') uid: string,
    @Body() body: SuspensionDto,
  ): Promise<void> {
    await this.users.suspend(user, uid, body.reason);
  }

  /** `204`: the account and the workspaces suspended with it are ACTIVE again. */
  @Post('users/:uid/unsuspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsuspendUser(@CurrentUser() user: AuthUser, @Param('uid') uid: string): Promise<void> {
    await this.users.unsuspend(user, uid);
  }

  /** US-X02: database, Redis and job counts of every queue. */
  @Get('health')
  health(): Promise<AdminHealth> {
    return this.admin.health();
  }
}
