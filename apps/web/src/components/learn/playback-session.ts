'use client';

import type { Download, Playback } from '@nibras/contracts';
import { useEffect, useRef, useState } from 'react';
import { api, asApiResult } from '../../lib/api';

/**
 * Where a player fetches its grant: the student's `/me/lessons/{lid}/playback`, or the teacher's
 * `/workspaces/{wid}/media/{mediaId}/playback` in the preview.
 */
export type PlaybackSource =
  { kind: 'learner'; lessonId: string } | { kind: 'teacher'; wid: string; mediaId: string | null };

/** A grant, an access refusal (`403 ENROLLMENT_REVOKED | COURSE_NOT_AVAILABLE`), or anything else. */
export type GrantOutcome = { grant: Playback } | { revoked: true } | { failed: true };

export interface SessionState {
  grant: Playback | null;
  status: 'loading' | 'ready' | 'revoked' | 'error';
}

/** What the players consume. */
export interface PlaybackSession extends SessionState {
  /** A new grant (single-flight); `null` when refused. */
  refresh: () => Promise<Playback | null>;
  /** The provider refused the URL (expired, revoked): renew once, then give up. */
  onProviderError: () => void;
  /** Playback works again: the next provider error may renew again. */
  onPlaybackOk: () => void;
}

/** A grant is renewed this long before it expires (AC-MED-05: silent re-request). */
export const REFRESH_LEAD_MS = 60_000;

/**
 * The grant's life cycle, free of React: single-flight `refresh`, a timer at `expiresAt − 60 s`
 * when `autoRefresh` (videos; a PDF's 5-min URL is only renewed when a fetch is refused, so an
 * open document does not spend the 30 grants/hour), paused while the page is hidden, and one
 * renewal per provider error until playback works again.
 */
export function createPlaybackSession({
  initial,
  fetchGrant,
  autoRefresh,
  onChange,
}: {
  initial: Playback | null;
  fetchGrant: () => Promise<GrantOutcome>;
  autoRefresh: boolean;
  onChange: (state: SessionState) => void;
}) {
  let state: SessionState = { grant: initial, status: initial ? 'ready' : 'loading' };
  let inflight: Promise<Playback | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retried = false;
  let hidden = false;
  let disposed = false;

  const set = (next: SessionState) => {
    state = next;
    onChange(next);
  };
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!autoRefresh || hidden || disposed || !state.grant) return;
    const delay = Date.parse(state.grant.expiresAt) - REFRESH_LEAD_MS - Date.now();
    timer = setTimeout(() => void refresh(), Math.max(0, delay));
  };
  const refresh = (): Promise<Playback | null> => {
    inflight ??= (async () => {
      let outcome: GrantOutcome;
      try {
        outcome = await fetchGrant();
      } catch {
        outcome = { failed: true };
      }
      if (disposed) return null;
      if ('grant' in outcome) {
        set({ grant: outcome.grant, status: 'ready' });
        schedule();
        return outcome.grant;
      }
      set({ grant: state.grant, status: 'revoked' in outcome ? 'revoked' : 'error' });
      return null;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    state: () => state,
    refresh,
    start: () => (state.grant ? schedule() : void refresh()),
    onProviderError: () => {
      if (retried) {
        set({ ...state, status: 'error' });
        return;
      }
      retried = true;
      void refresh();
    },
    onPlaybackOk: () => {
      retried = false;
    },
    setHidden: (value: boolean) => {
      hidden = value;
      if (value) clear();
      else schedule();
    },
    dispose: () => {
      disposed = true;
      clear();
    },
  };
}

/** `fetchGrant` for a source; `403 ENROLLMENT_REVOKED | COURSE_NOT_AVAILABLE` → `revoked`. */
export function grantFetcher(source: PlaybackSource): () => Promise<GrantOutcome> {
  return async () => {
    let result;
    if (source.kind === 'learner') {
      result = await api.GET('/me/lessons/{lid}/playback', {
        params: { path: { lid: source.lessonId } },
      });
    } else if (source.mediaId) {
      result = await api.GET('/workspaces/{wid}/media/{mediaId}/playback', {
        params: { path: { wid: source.wid, mediaId: source.mediaId } },
      });
    } else {
      return { failed: true };
    }
    const { data, error } = asApiResult<Playback>(result);
    if (data) return { grant: data };
    if (error?.code === 'ENROLLMENT_REVOKED' || error?.code === 'COURSE_NOT_AVAILABLE') {
      return { revoked: true };
    }
    return { failed: true };
  };
}

/** A PDF's 5-min `attachment` URL (`allowDownload` only), or `null`. */
export async function fetchDownloadUrl(source: PlaybackSource): Promise<string | null> {
  let result;
  if (source.kind === 'learner') {
    result = await api.GET('/me/lessons/{lid}/download', {
      params: { path: { lid: source.lessonId } },
    });
  } else if (source.mediaId) {
    result = await api.GET('/workspaces/{wid}/media/{mediaId}/download', {
      params: { path: { wid: source.wid, mediaId: source.mediaId } },
    });
  } else {
    return null;
  }
  return asApiResult<Download>(result).data?.url ?? null;
}

/** `createPlaybackSession` as a hook, paused while the document is hidden. */
export function usePlaybackSession({
  source,
  initial,
  autoRefresh,
}: {
  source: PlaybackSource;
  initial: Playback | null;
  autoRefresh: boolean;
}): PlaybackSession {
  const [state, setState] = useState<SessionState>({
    grant: initial,
    status: initial ? 'ready' : 'loading',
  });
  const controller = useRef<ReturnType<typeof createPlaybackSession> | null>(null);
  const key = source.kind === 'learner' ? source.lessonId : `${source.wid}/${source.mediaId}`;

  useEffect(() => {
    const c = createPlaybackSession({
      initial,
      fetchGrant: grantFetcher(source),
      autoRefresh,
      onChange: setState,
    });
    controller.current = c;
    c.start();
    const onVisibility = () => c.setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      c.dispose();
    };
    // One session per lesson/media: `source` and `initial` are read when it starts.
  }, [key, autoRefresh]);

  // Stable callbacks that reach the live controller when called.
  const [actions] = useState(() => ({
    refresh: () => controller.current?.refresh() ?? Promise.resolve(null),
    onProviderError: () => controller.current?.onProviderError(),
    onPlaybackOk: () => controller.current?.onPlaybackOk(),
  }));
  return { ...state, ...actions };
}
