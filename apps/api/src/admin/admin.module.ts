import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { UserSuspensionService } from './user-suspension.service';

/**
 * Super-admin console API (PRD §8.16.4). Imports `AuthModule` for `SessionService` (revoking a
 * suspended user's sessions); depends on the global `DbModule`, `RedisModule`, `QueueModule`
 * (`QUEUES_BY_NAME`), `AuditModule`, `ProvidersModule` and `EventEmitterModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, UserSuspensionService],
  exports: [UserSuspensionService],
})
export class AdminModule {}
