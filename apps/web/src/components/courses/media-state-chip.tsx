'use client';

import type { LessonMedia, MediaAssetView } from '@nibras/contracts';
import type { BadgeVariant } from '@nibras/ui';
import { Badge, Button } from '@nibras/ui';
import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMediaStatus } from '../../lib/use-media-status';

const VARIANT: Record<LessonMedia['status'], BadgeVariant> = {
  UPLOADING: 'info',
  PROCESSING: 'warning',
  READY: 'success',
  FAILED: 'danger',
  DELETING: 'neutral',
};

/** `125` → `2:05`, `3725` → `1:02:05` (digits stay Western in every locale, D-P16). */
export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * A lesson's media state in the structure editor (PRD §8.4.4): « Envoi en cours », « Traitement
 * en cours » (polled every 5 s until it settles, `useMediaStatus`), « Prêt » with the video's
 * duration or the PDF's page count, « Échec du traitement : {reason} » with « Réessayer » (a new
 * upload that replaces the lesson's media). Changes are announced (polite live region).
 */
export function MediaStateChip({
  wid,
  media,
  onSettled,
  onRetry,
}: {
  wid: string;
  media: LessonMedia;
  onSettled?: (asset: MediaAssetView) => void;
  onRetry?: () => void;
}) {
  const t = useTranslations();
  const { status, asset } = useMediaStatus(wid, media.id, media.status, onSettled);
  const durationS = asset?.durationS ?? media.durationS;
  const pageCount = asset?.pageCount ?? media.pageCount;
  const reason = asset?.failureReason ?? media.failureReason;

  let detail: string | null = null;
  if (status === 'READY' && media.kind === 'VIDEO' && durationS !== null) {
    detail = formatDuration(durationS);
  } else if (status === 'READY' && media.kind === 'PDF' && pageCount !== null) {
    detail = t('upload.pages', { count: pageCount });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2" aria-live="polite">
      <Badge variant={VARIANT[status]}>
        {status === 'FAILED'
          ? t('upload.failedReason', {
              reason: reason ? t(`upload.reason_${reason}`) : t('upload.reason_unknown'),
            })
          : t(`upload.status_${status}`)}
      </Badge>
      {detail ? <span className="text-sm text-fg-muted">{detail}</span> : null}
      {status === 'FAILED' && onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RotateCcw aria-hidden="true" className="size-4" />
          {t('upload.retry')}
        </Button>
      ) : null}
    </span>
  );
}
