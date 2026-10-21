import { Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
import {
  MEDIA_WEBHOOK_PROCESS_JOB,
  QUEUES,
  webhookProcessJobId,
  type MediaWebhookProcessJob,
} from '@nibras/contracts';
import { Prisma, type GuardedClient } from '@nibras/db';
import type { VideoProvider } from '@nibras/providers';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { Public } from '../auth/decorators/public';
import { ApiError } from '../common/api-error';
import { DB } from '../db/db.module';
import { QueueService } from '../queue/queue.service';
import { VIDEO_PROVIDER_TOKEN } from './tokens';

/** `200` body of an accepted notification; `duplicate` = already stored (a provider retry). */
export interface WebhookAck {
  received: true;
  duplicate: boolean;
}

/**
 * Signed notifications of the video provider (spec §4.3, §9, D11; Review Focus 6). `@Public()`
 * (the provider has no session; the global anonymous per-ip window applies). The HMAC is checked
 * over the exact bytes received (`req.rawBody`, `rawBody: true` in `main.ts`) with a ± 300 s
 * clock tolerance: a forged, stale or unsigned body → `401 WEBHOOK_SIGNATURE_INVALID { reason }`
 * and nothing stored. A valid one is stored as a `WebhookEvent` (idempotence key: sha256 of the
 * raw body) and processed by the `media.webhook.process` job; the same body again → `200
 * { duplicate: true }` and no second job. Only the configured provider has a route: any other
 * `:provider`, or a provider without webhooks (the S3 passthrough), is `404`.
 */
@Controller('webhooks/media')
@Public()
export class WebhooksController {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'webhookEvent'>,
    @Inject(VIDEO_PROVIDER_TOKEN) private readonly video: VideoProvider,
    private readonly queue: QueueService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(WebhooksController.name);
  }

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: Buffer },
  ): Promise<WebhookAck> {
    const name = this.video.name.toLowerCase();
    if (provider !== name) throw notFound();
    const verified = this.video.verifyWebhook({
      rawBody: req.rawBody ?? Buffer.alloc(0),
      headers: req.headers,
    });
    if (!verified.ok) {
      if (verified.reason === 'NO_WEBHOOKS') throw notFound();
      this.logger.warn({ provider: name, reason: verified.reason }, 'media.webhook_rejected');
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'WEBHOOK_SIGNATURE_INVALID',
        'Invalid webhook signature',
        { reason: verified.reason },
      );
    }
    let id: string;
    try {
      ({ id } = await this.db.webhookEvent.create({
        data: {
          provider: name,
          providerEventId: verified.eventId,
          // Normalised events (provider-neutral): the worker never re-parses provider formats.
          payload: { events: verified.events } as unknown as Prisma.InputJsonValue,
          signatureValid: true,
        },
        select: { id: true },
      }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.info({ provider: name }, 'media.webhook_duplicate');
        return { received: true, duplicate: true };
      }
      throw err;
    }
    const job: MediaWebhookProcessJob = { webhookEventId: id };
    await this.queue.add(QUEUES.media, MEDIA_WEBHOOK_PROCESS_JOB, job, {
      jobId: webhookProcessJobId(id),
    });
    this.logger.info({ provider: name, webhookEventId: id }, 'media.webhook_received');
    return { received: true, duplicate: false };
  }
}

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}
