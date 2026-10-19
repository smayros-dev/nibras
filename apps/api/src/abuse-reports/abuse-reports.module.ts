import { Module } from '@nestjs/common';
import {
  AccountAbuseReportsController,
  AdminAbuseReportsController,
  WorkspaceAbuseReportsController,
} from './abuse-reports.controller';
import { AbuseReportsService } from './abuse-reports.service';
import { SnapshotRegistry } from './snapshot.registry';

/**
 * Abuse reports (PRD §8.16, D-O6). Exports `SnapshotRegistry` (SP3/SP6/SP8 register their
 * entity's snapshot provider) and `AbuseReportsService` (`isEntityUnderReview` for SP8's `409
 * MESSAGE_UNDER_REVIEW`). Depends on the global `DbModule`, `AuditModule` and `QueueModule` (the
 * notification emails are sent by the worker: `abuse.report_created`).
 */
@Module({
  controllers: [
    WorkspaceAbuseReportsController,
    AccountAbuseReportsController,
    AdminAbuseReportsController,
  ],
  providers: [SnapshotRegistry, AbuseReportsService],
  exports: [SnapshotRegistry, AbuseReportsService],
})
export class AbuseReportsModule {}
