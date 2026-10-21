'use client';

import type { Playback } from '@nibras/contracts';
import { useToast } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { fetchDownloadUrl, usePlaybackSession, type PlaybackSource } from './playback-session';
import { PdfViewer } from './pdf-viewer';
import { VideoPlayer } from './video-player';

/**
 * A video or PDF lesson's media: one playback session (the page's grant, renewed through
 * `source`) feeding the player or the viewer. Videos renew ahead of expiry; a PDF renews only when
 * its URL is refused. The players are small and static; hls.js and pdf.js are imported by them on
 * demand, so neither library is part of the route's first load.
 */
export function LessonMedia({
  type,
  source,
  initial,
  title,
  watermarkText,
  allowDownload,
}: {
  type: 'VIDEO' | 'PDF';
  source: PlaybackSource;
  initial: Playback | null;
  title: string;
  watermarkText: string;
  allowDownload: boolean;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const session = usePlaybackSession({ source, initial, autoRefresh: type === 'VIDEO' });

  if (type === 'VIDEO') {
    return <VideoPlayer session={session} title={title} watermarkText={watermarkText} />;
  }
  return (
    <PdfViewer
      session={session}
      title={title}
      watermarkText={watermarkText}
      allowDownload={allowDownload}
      onDownload={async () => {
        const url = await fetchDownloadUrl(source).catch(() => null);
        if (url) window.location.assign(url);
        else toast({ title: t('learn.media.error'), variant: 'danger' });
      }}
    />
  );
}
