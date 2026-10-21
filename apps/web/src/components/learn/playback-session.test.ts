import type { Playback } from '@nibras/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPlaybackSession,
  grantFetcher,
  REFRESH_LEAD_MS,
  type GrantOutcome,
  type SessionState,
} from './playback-session';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const NOW = Date.parse('2026-10-21T08:00:00.000Z');

function mp4(url: string, ttlMs = 2 * 3600_000): Playback {
  return { kind: 'MP4', url, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(fetchGrant: () => Promise<GrantOutcome>, initial: Playback | null = mp4('u0')) {
  const states: SessionState[] = [];
  const session = createPlaybackSession({
    initial,
    fetchGrant,
    autoRefresh: true,
    onChange: (s) => states.push(s),
  });
  return { session, states };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  api.GET.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createPlaybackSession', () => {
  it('refresh is single-flight', async () => {
    const pending = deferred<GrantOutcome>();
    const fetchGrant = vi.fn(() => pending.promise);
    const { session } = setup(fetchGrant);
    const a = session.refresh();
    const b = session.refresh();
    expect(fetchGrant).toHaveBeenCalledTimes(1);
    pending.resolve({ grant: mp4('u1') });
    expect(await a).toEqual(await b);
    expect(session.state().grant?.url).toBe('u1');
  });

  it('fetches a grant at start when none was given (teacher preview)', async () => {
    const fetchGrant = vi.fn(async (): Promise<GrantOutcome> => ({ grant: mp4('u1') }));
    const { session } = setup(fetchGrant, null);
    expect(session.state().status).toBe('loading');
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state()).toMatchObject({ status: 'ready', grant: { url: 'u1' } });
  });

  it('renews silently 60 s before expiry, and not while the page is hidden', async () => {
    const fetchGrant = vi.fn(async (): Promise<GrantOutcome> => ({ grant: mp4('u1') }));
    const { session } = setup(fetchGrant);
    session.start();
    await vi.advanceTimersByTimeAsync(2 * 3600_000 - REFRESH_LEAD_MS - 1);
    expect(fetchGrant).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchGrant).toHaveBeenCalledTimes(1);
    expect(session.state().grant?.url).toBe('u1');

    session.setHidden(true);
    await vi.advanceTimersByTimeAsync(3 * 3600_000);
    expect(fetchGrant).toHaveBeenCalledTimes(1);
    session.setHidden(false); // overdue: renewed at once
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchGrant).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('a provider error refreshes once, then surfaces revoked on 403 ENROLLMENT_REVOKED', async () => {
    const fetchGrant = vi
      .fn<() => Promise<GrantOutcome>>()
      .mockResolvedValueOnce({ grant: mp4('u1') })
      .mockResolvedValueOnce({ revoked: true });
    const { session, states } = setup(fetchGrant);
    session.onProviderError();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state()).toMatchObject({ status: 'ready', grant: { url: 'u1' } });
    session.onPlaybackOk();
    session.onProviderError();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state().status).toBe('revoked');
    expect(states.at(-1)?.status).toBe('revoked');
  });

  it('a second provider error without successful playback in between is an error, not a loop', async () => {
    const fetchGrant = vi.fn(async (): Promise<GrantOutcome> => ({ grant: mp4('u1') }));
    const { session } = setup(fetchGrant);
    session.onProviderError();
    await vi.advanceTimersByTimeAsync(0);
    session.onProviderError();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchGrant).toHaveBeenCalledTimes(1);
    expect(session.state().status).toBe('error');
  });
});

describe('grantFetcher', () => {
  it('learner: GET /me/lessons/{lid}/playback; 403 ENROLLMENT_REVOKED and COURSE_NOT_AVAILABLE → revoked', async () => {
    const fetch = grantFetcher({ kind: 'learner', lessonId: 'l1' });
    api.GET.mockResolvedValueOnce({ data: mp4('u1') });
    expect(await fetch()).toEqual({ grant: mp4('u1') });
    expect(api.GET).toHaveBeenCalledWith('/me/lessons/{lid}/playback', {
      params: { path: { lid: 'l1' } },
    });
    for (const code of ['ENROLLMENT_REVOKED', 'COURSE_NOT_AVAILABLE']) {
      api.GET.mockResolvedValueOnce({ error: { code } });
      expect(await fetch()).toEqual({ revoked: true });
    }
    api.GET.mockResolvedValueOnce({ error: { code: 'RATE_LIMITED' } });
    expect(await fetch()).toEqual({ failed: true });
  });

  it('teacher: the workspace media playback route', async () => {
    api.GET.mockResolvedValueOnce({ data: mp4('u1') });
    await grantFetcher({ kind: 'teacher', wid: 'w1', mediaId: 'm1' })();
    expect(api.GET).toHaveBeenCalledWith('/workspaces/{wid}/media/{mediaId}/playback', {
      params: { path: { wid: 'w1', mediaId: 'm1' } },
    });
    expect(await grantFetcher({ kind: 'teacher', wid: 'w1', mediaId: null })()).toEqual({
      failed: true,
    });
  });
});
