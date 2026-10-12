import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AccountGatesGuard } from './auth/guards/account-gates.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RateLimitGuard, RateLimitModule } from './common/rate-limit.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ZodValidationPipe } from './common/zod-validation.pipe';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { ConsentModule } from './me/consent.module';
import { MeModule } from './me/me.module';
import { VerificationModule } from './me/verification.module';
import { MetricsMiddleware } from './observability/metrics.middleware';
import { ObservabilityModule } from './observability/observability.module';
import { ProvidersModule } from './providers/providers.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { TeacherVerifiedGuard } from './tenancy/teacher-verified.guard';

@Module({
  imports: [
    ObservabilityModule,
    DbModule,
    RedisModule,
    QueueModule,
    ProvidersModule,
    AuditModule,
    EventEmitterModule.forRoot(),
    AuthModule,
    // ConsentService for the global AccountGatesGuard (consents gate).
    ConsentModule,
    // VerificationService for the global TeacherVerifiedGuard.
    VerificationModule,
    MeModule,
    RateLimitModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Global guards run in this order: rate limit (so failed authentications count too), session,
    // the account gates, then the teacher-verified gate (only on `@RequireVerifiedTeacher()`
    // routes). Task 13 inserts the workspace context and permission guards before the last one.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccountGatesGuard },
    { provide: APP_GUARD, useClass: TeacherVerifiedGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including the unprefixed health endpoints (Nest 11 / path-to-regexp v8
    // wildcard). Metrics come right after the request id, so requests rejected later (unknown
    // routes, guards) are still timed.
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes('{*path}');
  }
}
