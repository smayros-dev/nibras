import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Playback } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import type { PlaybackSession } from './playback-session';
import { VideoPlayer } from './video-player';

const hls = vi.hoisted(() => {
  const instances: { loadSource: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] =
    [];
  const handlers = new Map<string, (event: string, data: { fatal: boolean }) => void>();
  class Hls {
    static Events = { ERROR: 'hlsError' };
    static isSupported = vi.fn(() => true);
    config: unknown;
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor(config: unknown) {
      this.config = config;
      instances.push(this);
    }
    on(event: string, handler: (event: string, data: { fatal: boolean }) => void) {
      handlers.set(event, handler);
    }
  }
  return { Hls, instances, handlers, imported: vi.fn() };
});
vi.mock('hls.js', () => {
  hls.imported();
  return { default: hls.Hls };
});

function session(grant: Playback | null, extra: Partial<PlaybackSession> = {}): PlaybackSession {
  return {
    grant,
    status: grant ? 'ready' : 'loading',
    refresh: vi.fn(async () => grant),
    onProviderError: vi.fn(),
    onPlaybackOk: vi.fn(),
    ...extra,
  };
}

const MP4: Playback = {
  kind: 'MP4',
  url: 'http://localhost:9000/v.mp4',
  expiresAt: '2026-10-21T10:00:00.000Z',
};
const HLS: Playback = {
  kind: 'HLS',
  url: 'https://cf.test/m.m3u8',
  expiresAt: '2026-10-21T10:00:00.000Z',
};

function renderPlayer(s: PlaybackSession, locale: 'fr' | 'ar' | 'en' = 'fr') {
  return renderWithIntl(
    <VideoPlayer session={s} title="Les fractions" watermarkText="lina@example.tn" />,
    { locale },
  );
}

function video(): HTMLVideoElement {
  return screen.getByTestId('video') as HTMLVideoElement;
}

beforeEach(() => {
  hls.instances.length = 0;
  hls.handlers.clear();
  hls.imported.mockClear();
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => '') as never;
});

describe('VideoPlayer', () => {
  it('plays an MP4 natively, without loading hls.js, and with no native controls', async () => {
    renderPlayer(session(MP4));
    await waitFor(() => expect(video().src).toBe(MP4.url));
    expect(video()).not.toHaveAttribute('controls');
    expect(video()).toHaveAttribute('playsinline');
    expect(video()).toHaveAttribute('preload', 'metadata');
    expect(hls.imported).not.toHaveBeenCalled();
    expect(screen.getByTestId('watermark')).toHaveTextContent('lina@example.tn');
  });

  it('plays HLS through hls.js with its worker enabled, and a fatal error renews the grant', async () => {
    const s = session(HLS);
    renderPlayer(s);
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    const [instance] = hls.instances;
    expect(instance?.loadSource).toHaveBeenCalledWith(HLS.url);
    expect((instance as unknown as { config: unknown }).config).toMatchObject({
      enableWorker: true,
    });
    act(() => hls.handlers.get('hlsError')?.('hlsError', { fatal: false }));
    expect(s.onProviderError).not.toHaveBeenCalled();
    act(() => hls.handlers.get('hlsError')?.('hlsError', { fatal: true }));
    expect(s.onProviderError).toHaveBeenCalledTimes(1);
  });

  it('uses native HLS when the browser can play it (Safari)', async () => {
    HTMLMediaElement.prototype.canPlayType = vi.fn((type: string) =>
      type === 'application/vnd.apple.mpegurl' ? 'maybe' : '',
    ) as never;
    renderPlayer(session(HLS));
    await waitFor(() => expect(video().src).toBe(HLS.url));
    expect(hls.instances).toHaveLength(0);
  });

  it('a media error asks the session for a new grant', async () => {
    const s = session(MP4);
    renderPlayer(s);
    fireEvent.error(video());
    expect(s.onProviderError).toHaveBeenCalledTimes(1);
    fireEvent.canPlay(video());
    expect(s.onPlaybackOk).toHaveBeenCalled();
  });

  it('requests fullscreen on the wrapper (the watermark stays visible), not on the video', async () => {
    const wrapperFullscreen = vi.fn(async () => undefined);
    const videoFullscreen = vi.fn(async () => undefined);
    renderPlayer(session(MP4));
    const wrapper = screen.getByRole('region', { name: /Les fractions/ });
    wrapper.requestFullscreen = wrapperFullscreen;
    video().requestFullscreen = videoFullscreen;
    await userEvent.click(screen.getByRole('button', { name: tr('fr', 'learn.media.fullscreen') }));
    expect(wrapperFullscreen).toHaveBeenCalled();
    expect(videoFullscreen).not.toHaveBeenCalled();
    expect(wrapper).toContainElement(screen.getByTestId('watermark'));
  });

  it('changes the playback rate from the speed control', async () => {
    renderPlayer(session(MP4));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: tr('fr', 'learn.media.speed') }),
      '1.5',
    );
    expect(video().playbackRate).toBe(1.5);
  });

  it('keyboard: Space plays, arrows seek 10 s, F toggles fullscreen', async () => {
    renderPlayer(session(MP4));
    const wrapper = screen.getByRole('region', { name: /Les fractions/ });
    const fullscreen = vi.fn(async () => undefined);
    wrapper.requestFullscreen = fullscreen;
    Object.defineProperty(video(), 'duration', { configurable: true, value: 100 });
    video().currentTime = 30;
    fireEvent.keyDown(wrapper, { key: ' ' });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' });
    expect(video().currentTime).toBe(40);
    fireEvent.keyDown(wrapper, { key: 'ArrowLeft' });
    fireEvent.keyDown(wrapper, { key: 'ArrowLeft' });
    expect(video().currentTime).toBe(20);
    fireEvent.keyDown(wrapper, { key: 'f' });
    expect(fullscreen).toHaveBeenCalled();
  });

  it('labels its controls in Arabic, with the position as text', () => {
    renderPlayer(session(MP4), 'ar');
    expect(screen.getByRole('button', { name: tr('ar', 'learn.media.play') })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: tr('ar', 'learn.media.seek') })).toHaveAttribute(
      'aria-valuetext',
    );
    expect(
      screen.getByRole('slider', { name: tr('ar', 'learn.media.volume') }),
    ).toBeInTheDocument();
  });

  it('a revoked session replaces the player with the access message', () => {
    renderPlayer(session(MP4, { status: 'revoked' }));
    expect(screen.getByText(tr('fr', 'learn.revoked'))).toBeInTheDocument();
    expect(screen.queryByTestId('video')).not.toBeInTheDocument();
  });
});
