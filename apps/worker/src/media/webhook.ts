import {
  MEDIA_PROVIDERS,
  type MediaProvider,
  type MediaWebhookProcessJob,
} from '@nibras/contracts';
import type { VideoWebhookEvent } from '@nibras/providers';
import type { Job } from 'bullmq';

import { FailureNotices } from './notify';
import { applyReady, isUuid, markFailed, readyInfo, type MediaDeps } from './state';

export interface WebhookProcessResult {
  applied: number;
  skipped?: 'not_found' | 'already_processed' | 'invalid_payload';
}

const STATES = new Set(['READY', 'FAILED', 'PROCESSING']);

/** The normalised events the API stored (`{ events: VideoWebhookEvent[] }`), or `null`. */
function eventsOf(payload: unknown): VideoWebhookEvent[] | null {
  if (!payload || typeof payload !== 'object' || !('events' in payload)) return null;
  const { events } = payload as { events: unknown };
  if (!Array.isArray(events)) return null;
  const valid = events.filter(
    (e): e is VideoWebhookEvent =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as VideoWebhookEvent).providerAssetId === 'string' &&
      (e as VideoWebhookEvent).providerAssetId.length > 0 &&
      STATES.has((e as VideoWebhookEvent).state),
  );
  return valid.length === events.length ? valid : null;
}

/**
 * `media.webhook.process { webhookEventId }` (spec §4.3, §11, Review Focus 6): applies a stored,
 * already verified `WebhookEvent` (nothing is re-verified) to its assets through the state
 * machine — `READY` only from `UPLOADING | PROCESSING` (numbers, `sizeBytes`, the provider's
 * bytes counted in the quota in the same transaction; over 4 h → `FAILED SIZE_MISMATCH`);
 * `FAILED` → `FAILED PROVIDER_ERROR` from the same states (the provider's code is logged only)
 * and the owner emailed; `PROCESSING` → from `UPLOADING` (`processingStartedAt`). A `READY` for a
 * `FAILED` asset, or any event for an unknown asset, is ignored (logged). `processedAt` is set
 * once every notice went out; a set `processedAt` makes the job a no-op.
 */
export async function processWebhook(
  deps: MediaDeps,
  job: Job<MediaWebhookProcessJob>,
): Promise<WebhookProcessResult> {
  const { webhookEventId } = job.data ?? {};
  if (!isUuid(webhookEventId)) return { applied: 0, skipped: 'not_found' };
  const { db, logger } = deps;
  const event = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return { applied: 0, skipped: 'not_found' };
  if (event.processedAt) return { applied: 0, skipped: 'already_processed' };

  const provider = event.provider.toUpperCase() as MediaProvider;
  const events = eventsOf(event.payload);
  if (!MEDIA_PROVIDERS.includes(provider) || !events) {
    logger.warn({ webhookEventId }, 'media.webhook_invalid_payload');
    await db.webhookEvent.updateMany({
      where: { id: event.id, processedAt: null },
      data: { processedAt: new Date(), error: 'INVALID_PAYLOAD' },
    });
    return { applied: 0, skipped: 'invalid_payload' };
  }

  const notices = new FailureNotices(deps, job);
  const jobId = String(job.id);
  let applied = 0;
  for (const e of events) {
    const asset = await db.mediaAsset.findFirst({
      where: { provider, providerAssetId: e.providerAssetId },
      select: { id: true, workspaceId: true, kind: true, status: true, sizeBytes: true },
    });
    if (!asset) {
      logger.info({ webhookEventId, state: e.state }, 'media.webhook_unknown_asset');
      continue;
    }
    const log = { webhookEventId, mediaId: asset.id, workspace_id: asset.workspaceId };
    if (e.state === 'READY') {
      const outcome = await applyReady(
        deps,
        asset,
        ['UPLOADING', 'PROCESSING'],
        // Cloudflare bytes are counted at READY (spec D17); the declared size when unreported.
        readyInfo({ ...e, status: 'READY' }, asset.sizeBytes),
        jobId,
      );
      if (outcome === 'FAILED') await notices.record(asset.id);
      if (outcome) applied += 1;
      else logger.info({ ...log, status: asset.status }, 'media.webhook_ready_ignored');
    } else if (e.state === 'FAILED') {
      logger.info(
        { ...log, providerErrorCode: e.providerErrorCode?.slice(0, 64) },
        'media.webhook_provider_error',
      );
      if (await markFailed(deps, asset, ['UPLOADING', 'PROCESSING'], 'PROVIDER_ERROR', jobId)) {
        await notices.record(asset.id);
        applied += 1;
      }
    } else {
      const { count } = await db.mediaAsset.updateMany({
        where: { id: asset.id, workspaceId: asset.workspaceId, status: 'UPLOADING' },
        data: { status: 'PROCESSING', processingStartedAt: new Date() },
      });
      applied += count;
    }
  }
  await notices.flush();
  await db.webhookEvent.updateMany({
    where: { id: event.id, processedAt: null },
    data: { processedAt: new Date() },
  });
  logger.info({ webhookEventId, events: events.length, applied }, 'media.webhook_processed');
  return { applied };
}
