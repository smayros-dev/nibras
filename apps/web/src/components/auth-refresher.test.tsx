import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter } from '../test/render';
import { AuthRefresher, REFRESH_CHECK_MS } from './auth-refresher';

const refreshSession = vi.fn(async () => true);
const lastRefreshAt = vi.fn(() => 0);

vi.mock('../lib/auth-refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth-refresh')>()),
  refreshSession: () => refreshSession(),
  lastRefreshAt: () => lastRefreshAt(),
}));

const INTERVAL = 13 * 60 * 1000;

describe('AuthRefresher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshSession.mockClear();
    lastRefreshAt.mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes once the interval has passed since mount, not before', () => {
    render(<AuthRefresher />);
    act(() => vi.advanceTimersByTime(INTERVAL - REFRESH_CHECK_MS));
    expect(refreshSession).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(REFRESH_CHECK_MS));
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh when another tab refreshed recently', () => {
    render(<AuthRefresher />);
    lastRefreshAt.mockImplementation(() => Date.now() - 60_000);
    act(() => vi.advanceTimersByTime(INTERVAL + REFRESH_CHECK_MS));
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes when the tab becomes visible after a long sleep', () => {
    render(<AuthRefresher />);
    vi.setSystemTime(Date.now() + INTERVAL + 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('sends the user to login with next on nibras:session-expired, once', () => {
    const router = mockRouter({ pathname: '/app/settings/profile' });
    render(<AuthRefresher />);
    act(() => {
      window.dispatchEvent(new CustomEvent('nibras:session-expired'));
      window.dispatchEvent(new CustomEvent('nibras:session-expired'));
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fapp%2Fsettings%2Fprofile');
  });

  it('dispatches nibras:session-expired when a proactive refresh fails', async () => {
    const router = mockRouter({ pathname: '/app' });
    refreshSession.mockResolvedValueOnce(false);
    render(<AuthRefresher />);
    await act(async () => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fapp');
  });

  it('does not end the session when the proactive refresh fails offline', async () => {
    const router = mockRouter({ pathname: '/app' });
    refreshSession.mockResolvedValueOnce(false);
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<AuthRefresher />);
    await act(async () => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    onLine.mockRestore();
  });
});
