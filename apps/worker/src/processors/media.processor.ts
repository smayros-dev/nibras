import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  MEDIA_CLEANUP_JOB,
  MEDIA_DELETE_JOB,
  MEDIA_PROCESS_JOB,
  MEDIA_WEBHOOK_PROCESS_JOB,
  QUEUES,
  type MediaDeleteJob,
  type MediaProcessJob,
  type MediaWebhookProcessJob,
} from '@nibras/contracts';
import type { PrismaClient } from '@nibras/db';
import {
  S3VideoProvider,
  type EmailProvider,
  type StorageProvider,
  type VideoProvider,
} from '@nibras/providers';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { WORKER_ENV, type WorkerEnv } from '../env';
import { WORKER_LOGGER } from '../logger';
import { cleanupMedia } from '../media/cleanup';
import { deleteMedia } from '../media/delete';
import { processMedia } from '../media/process';
import type { MediaDeps } from '../media/state';
import { processWebhook } from '../media/webhook';
import { EMAIL_PROVIDER, STORAGE_PROVIDER, VIDEO_PROVIDER_TOKEN } from '../providers';
import { ProcessorRegistry } from '../queues';
import { WORKER_DB } from '../worker-db';

/**
 * The four `media` jobs (spec §11): `media.process` (S3 objects after `complete`),
 * `media.webhook.process` (stored provider notifications), `media.cleanup_abandoned` (hourly
 * scheduler) and `media.delete` (`DELETING` assets). See `src/media/*` for each state machine.
 */
@Injectable()
export class MediaProcessor implements OnModuleInit {
  private readonly deps: MediaDeps;

  constructor(
    private readonly registry: ProcessorRegistry,
    @Inject(WORKER_DB) db: PrismaClient,
    @Inject(STORAGE_PROVIDER) storage: StorageProvider,
    @Inject(VIDEO_PROVIDER_TOKEN) video: VideoProvider,
    @Inject(EMAIL_PROVIDER) email: EmailProvider,
    @Inject(WORKER_ENV) env: WorkerEnv,
    @Inject(WORKER_LOGGER) logger: Logger,
  ) {
    this.deps = {
      db,
      storage,
      video,
      s3Video: new S3VideoProvider(storage),
      email,
      webOrigin: env.WEB_ORIGIN,
      logger,
    };
  }

  onModuleInit(): void {
    this.registry.registerProcessor(QUEUES.media, MEDIA_PROCESS_JOB, (job) =>
      processMedia(this.deps, job as Job<MediaProcessJob>),
    );
    this.registry.registerProcessor(QUEUES.media, MEDIA_WEBHOOK_PROCESS_JOB, (job) =>
      processWebhook(this.deps, job as Job<MediaWebhookProcessJob>),
    );
    this.registry.registerProcessor(QUEUES.media, MEDIA_CLEANUP_JOB, (job) =>
      cleanupMedia(this.deps, job),
    );
    this.registry.registerProcessor(QUEUES.media, MEDIA_DELETE_JOB, (job) =>
      deleteMedia(this.deps, job as Job<MediaDeleteJob>),
    );
  }
}
