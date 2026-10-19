import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * CSV import of student invitations (PRD §8.3.4; design §4.5): preview, confirm (queues
 * `invitations.import_csv` for the worker), status and report. Registered in `AppModule` before
 * `InvitationsModule` (shared `workspaces/:wid/invitations` prefix). Depends on the global
 * `DbModule`, `AuditModule` and `QueueModule`.
 */
@Module({
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
