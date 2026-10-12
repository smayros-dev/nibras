import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PWNED_CLIENT, ProvidersModule } from '../providers/providers.module';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { PwnedPasswordClient } from './crypto/hibp';
import { PasswordPolicy } from './crypto/password-policy';
import { EmailChangeService } from './email-change.service';
import { EmailVerificationService } from './email-verification.service';
import { JwtService } from './jwt.service';
import { LoginThrottleService } from './login-throttle.service';
import { MeController } from './me.controller';
import { PasswordController } from './password.controller';
import { PasswordResetService } from './password-reset.service';
import { ReauthLimiter } from './reauth-limiter';
import { RegisterService } from './register.service';
import { SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [AuditModule, ProvidersModule],
  controllers: [AuthController, PasswordController, MeController],
  providers: [
    // HIBP when `HIBP_ENABLED`, else the no-op client (`createPwnedClient`); tests inject a fake.
    {
      provide: PasswordPolicy,
      inject: [PWNED_CLIENT],
      useFactory: (pwned: PwnedPasswordClient) => new PasswordPolicy(pwned),
    },
    { provide: JwtService, useFactory: () => new JwtService(env.JWT_SECRET) },
    EmailVerificationService,
    RegisterService,
    SessionService,
    LoginThrottleService,
    AuthService,
    ReauthLimiter,
    PasswordResetService,
    EmailChangeService,
    TwoFactorService,
  ],
  exports: [PasswordPolicy, EmailVerificationService, RegisterService, JwtService, SessionService],
})
export class AuthModule {}
