import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { PlaybackService } from './playback.service';
import { QuotaService } from './quota.service';
import { UploadService } from './upload.service';
import { WebhooksController } from './webhooks.controller';

/**
 * Media (SP3, spec §4.3–4.4): upload tickets (S3 multipart / tus), resume, completion with size,
 * signature and quota checks, playback and download URLs, deletion, and the provider's signed
 * webhooks. Depends on the global `DbModule`, `RedisModule` (the playback window), `AuditModule`,
 * `QueueModule` and `ProvidersModule` (`STORAGE_PROVIDER`, `VIDEO_PROVIDER_TOKEN`). Exports
 * `PlaybackService` and `QuotaService` for the learn routes (T10).
 */
@Module({
  controllers: [MediaController, WebhooksController],
  providers: [MediaService, UploadService, PlaybackService, QuotaService],
  exports: [MediaService, PlaybackService, QuotaService],
})
export class MediaModule {}
