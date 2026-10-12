import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConsentService } from './consent.service';

/**
 * `ConsentService` on its own, so the auth module (login response), the global
 * `AccountGatesGuard` (consents gate) and the `me` module share it without a module cycle.
 */
@Module({
  imports: [AuditModule],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
