import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { ImportAccepted, ImportPreview, InvitationImportStatus } from '@nibras/contracts';
import type { Response } from 'express';
import { invitationCtx } from '../invitations/invitations.service';
import { RequirePermission, RequireVerifiedTeacher } from '../tenancy/decorators';
import { ImportQueryDto, ImportRequestDto } from './dto';
import { ImportsService } from './imports.service';

/**
 * CSV import of student invitations (PRD §8.3.4, AC-INV-07). Same prefix as
 * `InvitationsController`: `ImportsModule` is registered before `InvitationsModule` so these
 * routes are matched first (`import/…` is never read as an invitation `:id`). Scope: an
 * organisation TEACHER sees only the imports he started (`invitationCtx`).
 */
@Controller('workspaces/:wid/invitations/import')
@RequirePermission('student.invite')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /**
   * `?dryRun=true` → `200 ImportPreview` (nothing written); else `202 { importId }` (the job is
   * queued). `413 IMPORT_TOO_LARGE` beyond 500 rows (`413 PAYLOAD_TOO_LARGE` beyond 1 MiB), `422
   * IMPORT_NO_VALID_ROWS`, `409 IMPORT_IN_PROGRESS`.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireVerifiedTeacher()
  async import(
    @Param('wid') wid: string,
    @Query() query: ImportQueryDto,
    @Body() body: ImportRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImportPreview | ImportAccepted> {
    const ctx = invitationCtx(wid);
    if (query.dryRun) return this.imports.preview(ctx, body);
    const accepted = await this.imports.confirm(ctx, body);
    res.status(HttpStatus.ACCEPTED);
    return accepted;
  }

  @Get(':importId')
  status(
    @Param('wid') wid: string,
    @Param('importId') importId: string,
  ): Promise<InvitationImportStatus> {
    return this.imports.status(invitationCtx(wid), importId);
  }

  /** The per-line report as a CSV attachment (UTF-8 with BOM). */
  @Get(':importId/report')
  async report(
    @Param('wid') wid: string,
    @Param('importId') importId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { fileName, csv } = await this.imports.report(invitationCtx(wid), importId);
    res
      .status(HttpStatus.OK)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(csv);
  }
}
