import { Module } from '@nestjs/common';
import { TokenAttemptLimiter } from '../common/token-attempt-limiter';
import { GuardianMailerService } from './guardian-mailer.service';
import { GuardianRequestService } from './guardian-request.service';
import { GuardianController } from './guardian.controller';
import { GuardianService } from './guardian.service';
import { MeGuardianController } from './me-guardian.controller';
import { StudentGuardianController } from './student-guardian.controller';

/**
 * Guardian consent (PRD §8.3.5, D-O5; design §4.4): the public consent page and guardian page,
 * the consent resends of the staff and of the student, and the shared `GuardianRequestService`
 * (start a consent cycle — used by the invitation acceptance, the join codes and the approval
 * queue, so exported for `InvitationsModule` and `InviteLinksModule`). Depends on the global
 * `DbModule`, `RedisModule`, `AuditModule`, `ProvidersModule` and `EventEmitterModule`.
 */
@Module({
  controllers: [GuardianController, MeGuardianController, StudentGuardianController],
  providers: [GuardianRequestService, GuardianService, GuardianMailerService, TokenAttemptLimiter],
  exports: [GuardianRequestService],
})
export class GuardianModule {}
