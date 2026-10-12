import { Module } from '@nestjs/common';
import { ConsentModule } from './consent.module';
import { VerificationService } from './verification.service';

/**
 * `VerificationService` on its own, so the `me` module (`GET /me/verification`) and the global
 * `TeacherVerifiedGuard` share it without a module cycle.
 */
@Module({
  imports: [ConsentModule],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
