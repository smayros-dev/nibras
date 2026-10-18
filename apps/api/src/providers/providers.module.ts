import { Global, Module } from '@nestjs/common';
import {
  LogSmsProvider,
  SmtpEmailProvider,
  type EmailProvider,
  type SmsLogger,
  type SmsProvider,
} from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { FakePwnedClient, HibpClient, type PwnedPasswordClient } from '../auth/crypto/hibp';
import { SecretBox } from '../auth/crypto/secret-box';
import { env, type Env } from '../config/env';

/** `EmailProvider` (SMTP; `InMemoryEmailProvider` in tests). */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
/** `SmsProvider` (`SMS_PROVIDER=console` → `LogSmsProvider`; `InMemorySmsProvider` in tests). */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
/** `PwnedPasswordClient` for the password policy (HIBP or the no-op fake). */
export const PWNED_CLIENT = Symbol('PWNED_CLIENT');
/** `SecretBox` keyed by `TOTP_ENCRYPTION_KEY` (TOTP seeds at rest). */
export const SECRET_BOX = Symbol('SECRET_BOX');

export function createEmailProvider(e: Pick<Env, 'SMTP_URL' | 'EMAIL_FROM'>): EmailProvider {
  return new SmtpEmailProvider({ smtpUrl: e.SMTP_URL, from: e.EMAIL_FROM });
}

export function createSmsProvider(e: Pick<Env, 'SMS_PROVIDER'>, logger: SmsLogger): SmsProvider {
  switch (e.SMS_PROVIDER) {
    case 'console':
      return new LogSmsProvider(logger);
  }
}

/** HIBP range lookups when `HIBP_ENABLED`, otherwise a client that reports nothing breached. */
export function createPwnedClient(e: Pick<Env, 'HIBP_ENABLED'>): PwnedPasswordClient {
  return e.HIBP_ENABLED ? new HibpClient() : new FakePwnedClient();
}

export function createSecretBox(e: Pick<Env, 'TOTP_ENCRYPTION_KEY'>): SecretBox {
  return new SecretBox(e.TOTP_ENCRYPTION_KEY);
}

/** Outbound providers and the crypto clients configured from the env; overridden in tests. */
@Global()
@Module({
  providers: [
    { provide: EMAIL_PROVIDER, useFactory: () => createEmailProvider(env) },
    {
      provide: SMS_PROVIDER,
      inject: [PinoLogger],
      useFactory: (logger: PinoLogger) => {
        logger.setContext('SmsProvider');
        return createSmsProvider(env, logger);
      },
    },
    { provide: PWNED_CLIENT, useFactory: () => createPwnedClient(env) },
    { provide: SECRET_BOX, useFactory: () => createSecretBox(env) },
  ],
  exports: [EMAIL_PROVIDER, SMS_PROVIDER, PWNED_CLIENT, SECRET_BOX],
})
export class ProvidersModule {}
