import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  INLINE_URL_TTL_S,
  PLAYBACK_TOKENS_PER_HOUR,
  PLAYBACK_TTL_S,
  type Download,
  type Playback,
} from '@nibras/contracts';
import type { MediaAsset } from '@nibras/db';
import type { StorageProvider, VideoProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { hitWindow, rateLimited, type RateRedis } from '../auth/rate-window';
import { ApiError } from '../common/api-error';
import { mediaPlaybackIssued } from '../observability/metrics';
import { REDIS } from '../redis/redis.module';
import { STORAGE_PROVIDER, VIDEO_PROVIDER_TOKEN } from './tokens';

/** The asset columns playback needs. */
export type PlayableAsset = Pick<
  MediaAsset,
  | 'id'
  | 'kind'
  | 'provider'
  | 'status'
  | 'storageKey'
  | 'providerAssetId'
  | 'mimeType'
  | 'originalFilename'
>;

/** One hour: the playback window of `PLAYBACK_TOKENS_PER_HOUR`. */
const PLAYBACK_WINDOW_S = 3600;

const playbackKey = (userId: string) => `playback:${userId}`;

function notReady(asset: PlayableAsset): ApiError {
  return new ApiError(HttpStatus.CONFLICT, 'MEDIA_NOT_READY', 'The media is not ready', {
    status: asset.status,
  });
}

function wrongKind(asset: PlayableAsset, expected: readonly string[]): ApiError {
  return new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MEDIA_KIND_MISMATCH',
    'This action does not apply to this media',
    { kind: asset.kind, expected },
  );
}

/**
 * Playback and download URLs (PRD D-O8, spec §4.4): bearer URLs by design — video 2 h (S3
 * presigned GET or Cloudflare signed manifest), PDF inline 5 min, PDF download 5 min with
 * `attachment`. A fixed Redis window of `PLAYBACK_TOKENS_PER_HOUR` playback grants per user and
 * hour (`429 RATE_LIMITED` beyond, with a `warn` line: the sharing alert). Each grant is logged
 * (`media.playback_issued`, ids only) and counted (`media_playback_issued_total`), never audited
 * (D13). URLs are never logged. Callers check access first: the teacher routes here (T7), the
 * student routes with `allowDownload` (T10).
 */
@Injectable()
export class PlaybackService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(VIDEO_PROVIDER_TOKEN) private readonly video: VideoProvider,
    @Inject(REDIS) private readonly redis: RateRedis,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PlaybackService.name);
  }

  /**
   * A playback grant for a READY VIDEO or PDF (`409 MEDIA_NOT_READY` otherwise; another kind →
   * `422 MEDIA_KIND_MISMATCH`). `allowDownload` is echoed on PDF grants (teachers: always true).
   */
  async playback(
    userId: string,
    workspaceId: string,
    asset: PlayableAsset,
    options: { allowDownload: boolean },
  ): Promise<Playback> {
    if (asset.kind !== 'VIDEO' && asset.kind !== 'PDF') throw wrongKind(asset, ['VIDEO', 'PDF']);
    if (asset.status !== 'READY') throw notReady(asset);
    const { count, ttl } = await hitWindow(this.redis, playbackKey(userId), PLAYBACK_WINDOW_S);
    if (count > PLAYBACK_TOKENS_PER_HOUR) {
      this.logger.warn(
        { userId, workspaceId, mediaId: asset.id, count },
        'media.playback_rate_exceeded',
      );
      throw rateLimited(ttl, 'Too many playback requests, try again later');
    }
    const grant: Playback =
      asset.kind === 'VIDEO'
        ? await this.videoGrant(asset)
        : {
            kind: 'PDF',
            url: await this.storage.signGetUrl(this.key(asset), INLINE_URL_TTL_S, {
              disposition: 'inline',
              contentType: asset.mimeType,
            }),
            expiresAt: inSeconds(INLINE_URL_TTL_S),
            allowDownload: options.allowDownload,
          };
    this.logger.info(
      { mediaId: asset.id, userId, workspaceId, kind: grant.kind, expiresAt: grant.expiresAt },
      'media.playback_issued',
    );
    mediaPlaybackIssued.inc({ kind: grant.kind });
    return grant;
  }

  /**
   * A 5-minute `attachment` URL of a READY PDF named after its original file name (`422` for
   * another kind, `409` when not READY). The caller enforces `allowDownload` (students, T10).
   */
  async download(userId: string, workspaceId: string, asset: PlayableAsset): Promise<Download> {
    if (asset.kind !== 'PDF') throw wrongKind(asset, ['PDF']);
    if (asset.status !== 'READY') throw notReady(asset);
    const url = await this.storage.signGetUrl(this.key(asset), INLINE_URL_TTL_S, {
      disposition: 'attachment',
      filename: asset.originalFilename,
      contentType: asset.mimeType,
    });
    this.logger.info({ mediaId: asset.id, userId, workspaceId }, 'media.download_issued');
    return { url, expiresAt: inSeconds(INLINE_URL_TTL_S), filename: asset.originalFilename };
  }

  /**
   * The configured provider signs its own videos (`S3VideoProvider`: presigned GET, `MP4`;
   * Cloudflare: signed manifest, `HLS`); an S3 object left from before a provider switch is
   * presigned directly.
   */
  private async videoGrant(asset: PlayableAsset): Promise<Playback> {
    if (asset.provider === this.video.name) {
      const grant = await this.video.signPlayback(
        {
          ...(asset.providerAssetId && { providerAssetId: asset.providerAssetId }),
          ...(asset.storageKey && { storageKey: asset.storageKey }),
        },
        { ttlS: PLAYBACK_TTL_S },
      );
      return { kind: grant.kind, url: grant.url, expiresAt: grant.expiresAt.toISOString() };
    }
    if (asset.provider !== 'S3') throw notReady(asset);
    const url = await this.storage.signGetUrl(this.key(asset), PLAYBACK_TTL_S, {
      disposition: 'inline',
      contentType: asset.mimeType,
    });
    return { kind: 'MP4', url, expiresAt: inSeconds(PLAYBACK_TTL_S) };
  }

  private key(asset: PlayableAsset): string {
    if (!asset.storageKey) throw notReady(asset);
    return asset.storageKey;
  }
}

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();
