'use client';

import type { MediaAssetView } from '@nibras/contracts';
import { MEDIA_STATUS_POLL_MS, type MediaStatus } from '@nibras/contracts/web';
import { useEffect, useRef, useState } from 'react';
import { api, asApiResult } from './api';

const PENDING: readonly MediaStatus[] = ['UPLOADING', 'PROCESSING'];

/**
 * The live state of a media asset (owner ruling Q2): while it is `UPLOADING` or `PROCESSING`,
 * `GET …/media/{id}` every `MEDIA_STATUS_POLL_MS` (5 s), skipped while the tab is hidden; polling
 * stops at `READY`, `FAILED` (or `DELETING`). `onSettled` runs once when it leaves the pending
 * states (the course's publish blockers may have changed).
 */
export function useMediaStatus(
  wid: string,
  mediaId: string,
  initial: MediaStatus,
  onSettled?: (asset: MediaAssetView) => void,
): { status: MediaStatus; asset: MediaAssetView | null } {
  const [status, setStatus] = useState<MediaStatus>(initial);
  const [asset, setAsset] = useState<MediaAssetView | null>(null);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  });

  // A new id or a new server state (structure reload) restarts from the given status.
  useEffect(() => {
    setStatus(initial);
    setAsset(null);
  }, [mediaId, initial]);

  const pending = PENDING.includes(status);
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (typeof document === 'undefined' || !document.hidden) {
        try {
          const { data } = asApiResult<MediaAssetView>(
            await api.GET('/workspaces/{wid}/media/{mediaId}', {
              params: { path: { wid, mediaId } },
            }),
          );
          if (stopped) return;
          if (data) {
            setAsset(data);
            setStatus(data.status);
            if (!PENDING.includes(data.status)) {
              settled.current?.(data);
              return;
            }
          }
        } catch {
          // A failed poll is retried on the next tick.
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), MEDIA_STATUS_POLL_MS);
    };
    timer = setTimeout(() => void tick(), MEDIA_STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pending, wid, mediaId]);

  return { status, asset };
}
