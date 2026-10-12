import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { WorkspaceDetail, WorkspaceSettings, WorkspaceStorage } from '@tt/contracts';
import { CurrentUser } from '../auth/decorators/current-user';
import type { AuthUser } from '../common/request-context';
import { RequirePermission } from '../tenancy/decorators';
import {
  CreateOrganizationDto,
  TransferOwnershipDto,
  UpdateWorkspaceDto,
  WorkspaceSettingsPatchDto,
} from './dto';
import { WorkspaceSettingsService } from './workspace-settings.service';
import { workspaceContext } from './workspace-context';
import { WorkspacesService } from './workspaces.service';

/**
 * Workspaces (PRD §8.2, §15). `POST /workspaces` has no `:wid`: any signed-in user past the
 * account gates may create an organisation. Every `:wid` route runs behind
 * `WorkspaceContextGuard` (non-member → 404, SUSPENDED/DELETING → 423 on mutations) and, where
 * marked, the §7 permission.
 */
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly settings: WorkspaceSettingsService,
  ) {}

  /** `201`: a new ORGANIZATION with the caller as OWNER (200 GiB, PRD §8.2.1 settings). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateOrganizationDto,
  ): Promise<WorkspaceDetail> {
    return this.workspaces.createOrganization(user, body);
  }

  /** Any active member: the workspace and the caller's `myRole` / `myCanTeach`. */
  @Get(':wid')
  detail(@Param('wid') wid: string): Promise<WorkspaceDetail> {
    return this.workspaces.detail(wid, workspaceContext().membership);
  }

  /**
   * Name, country, default time zone / locale, `allowPersonalWorkspaces` (ORGANIZATION only,
   * else `422`). Audited `workspace.updated`.
   */
  @Patch(':wid')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workspace.settings.update')
  update(@Param('wid') wid: string, @Body() body: UpdateWorkspaceDto): Promise<WorkspaceDetail> {
    return this.workspaces.update(wid, body, workspaceContext().membership);
  }

  /** Any active member: the PRD §8.2.1 settings. */
  @Get(':wid/settings')
  getSettings(@Param('wid') wid: string): Promise<WorkspaceSettings> {
    return this.settings.get(wid);
  }

  /**
   * Partial update merged into the stored settings, the result validated as a whole (`422
   * VALIDATION_FAILED`, e.g. `partial_ratio ≥ present_ratio`). Audited `workspace.settings_updated`.
   */
  @Patch(':wid/settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workspace.settings.update')
  updateSettings(
    @Param('wid') wid: string,
    @Body() body: WorkspaceSettingsPatchDto,
  ): Promise<WorkspaceSettings> {
    return this.settings.update(wid, body);
  }

  /** Quota and usage in bytes, as decimal strings. */
  @Get(':wid/storage')
  @RequirePermission('workspace.settings.update')
  storage(@Param('wid') wid: string): Promise<WorkspaceStorage> {
    return this.workspaces.storage(wid);
  }

  /** OWNER only: `204`, the workspace turns `DELETING` (read-only; purged after 30 days, SP11). */
  @Delete(':wid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('workspace.delete')
  async remove(@Param('wid') wid: string): Promise<void> {
    await this.workspaces.softDelete(wid);
  }

  /**
   * OWNER only, ORGANIZATION only (`409 NOT_AN_ORGANIZATION`): `204`, the target ACTIVE ADMIN
   * becomes OWNER and the caller ADMIN (`422 VALIDATION_FAILED` for any other target).
   */
  @Post(':wid/transfer-ownership')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('workspace.transfer')
  async transferOwnership(
    @CurrentUser() user: AuthUser,
    @Param('wid') wid: string,
    @Body() body: TransferOwnershipDto,
  ): Promise<void> {
    await this.workspaces.transferOwnership(wid, user.id, body.toUserId);
  }
}
