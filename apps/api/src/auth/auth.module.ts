import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PWNED_CLIENT, ProvidersModule } from '../providers/providers.module';
import { AuthController } from './auth.controller';
import type { PwnedPasswordClient } from './crypto/hibp';
import { PasswordPolicy } from './crypto/password-policy';
import { EmailVerificationService } from './email-verification.service';
import { RegisterService } from './register.service';

@Module({
  imports: [AuditModule, ProvidersModule],
  controllers: [AuthController],
  providers: [
    // HIBP when `HIBP_ENABLED`, else the no-op client (`createPwnedClient`); tests inject a fake.
    {
      provide: PasswordPolicy,
      inject: [PWNED_CLIENT],
      useFactory: (pwned: PwnedPasswordClient) => new PasswordPolicy(pwned),
    },
    EmailVerificationService,
    RegisterService,
  ],
  exports: [PasswordPolicy, EmailVerificationService, RegisterService],
})
export class AuthModule {}
