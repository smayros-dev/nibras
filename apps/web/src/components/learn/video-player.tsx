'use client';

import { Alert, Spinner } from '@nibras/ui';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { PlaybackSession } from './playback-session';
import { Watermark } from './watermark';

const RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const SEEK_STEP_S = 10;
const HLS_MIME = 'application/vnd.apple.mpegurl';

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

const BUTTON =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white';

/**
 * The video player (PRD §8.6, D-O8): native `<video>` for an MP4 grant and for HLS where the
 * browser plays it (Safari), hls.js otherwise — imported only then, so an MP4 never loads it.
 * Own controls (no `controls` attribute: a native menu or fullscreen would hide the watermark);
 * fullscreen is requested on the wrapper, which holds the watermark. Keyboard on the wrapper:
 * Space play/pause, ←/→ 10 s, F fullscreen. A media error asks the session for a new grant (an
 * expired URL is renewed silently, AC-MED-05) and the new URL resumes where playback was.
 */
export function VideoPlayer({
  session,
  title,
  watermarkText,
}: {
  session: PlaybackSession;
  title: string;
  watermarkText: string;
}) {
  const t = useTranslations();
  const speedId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const url = session.grant?.url;
  const kind = session.grant?.kind;
  const visible = session.status !== 'revoked' && session.status !== 'error';

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    // A renewed grant resumes where the previous URL stopped.
    const resumeAt = video.currentTime;
    const wasPlaying = !video.paused;
    const resume = () => {
      if (resumeAt > 0) video.currentTime = resumeAt;
      if (wasPlaying) void video.play()?.catch(() => undefined);
    };
    video.addEventListener('loadedmetadata', resume, { once: true });
    let cancelled = false;
    let destroy: (() => void) | undefined;
    if (kind !== 'HLS' || video.canPlayType(HLS_MIME)) {
      video.src = url;
    } else {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setUnsupported(true);
            return;
          }
          // The transmuxer runs in a `blob:` worker (`worker-src 'self' blob:`).
          const hls = new Hls({ enableWorker: true });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) sessionRef.current.onProviderError();
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          destroy = () => hls.destroy();
        })
        .catch(() => setUnsupported(true));
    }
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', resume);
      destroy?.();
    };
  }, [url, kind, visible]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (session.status === 'revoked') return <Alert variant="danger">{t('learn.revoked')}</Alert>;
  if (session.status === 'error' || unsupported) {
    return <Alert variant="danger">{t('learn.media.error')}</Alert>;
  }

  const video = () => videoRef.current;
  const toggle = () => {
    const v = video();
    if (!v) return;
    if (v.paused) void v.play()?.catch(() => undefined);
    else v.pause();
  };
  const seekTo = (seconds: number) => {
    const v = video();
    if (!v) return;
    const end = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
    v.currentTime = Math.min(Math.max(0, seconds), end);
    setTime(v.currentTime);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => undefined);
    else void wrapperRef.current?.requestFullscreen?.()?.catch(() => undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Controls keep their own keys (Space on a button, arrows on a slider or the speed menu).
    if (target !== event.currentTarget && target.matches('button, input, select')) return;
    const key = event.key;
    if (key === ' ' || key === 'k') toggle();
    else if (key === 'ArrowRight') seekTo((video()?.currentTime ?? 0) + SEEK_STEP_S);
    else if (key === 'ArrowLeft') seekTo((video()?.currentTime ?? 0) - SEEK_STEP_S);
    else if (key === 'f' || key === 'F') toggleFullscreen();
    else return;
    event.preventDefault();
  };
  const position = t('learn.media.position', { current: clock(time), total: clock(duration) });

  return (
    <div
      ref={wrapperRef}
      role="region"
      aria-label={t('learn.media.player', { title })}
      aria-describedby={`${speedId}-keys`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative overflow-hidden rounded-md bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <video
        ref={videoRef}
        data-testid="video"
        playsInline
        preload="metadata"
        className="aspect-video w-full"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onCanPlay={() => session.onPlaybackOk()}
        onError={() => session.onProviderError()}
      />
      {session.status === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center text-white">
          <Spinner label={t('learn.media.loading')} />
        </div>
      ) : null}
      <Watermark text={watermarkText} />
      <p id={`${speedId}-keys`} className="sr-only">
        {t('learn.media.keys')}
      </p>
      <div className="relative z-20 flex flex-wrap items-center gap-x-2 gap-y-1 bg-black/70 px-2 py-1 text-sm text-white">
        <button
          type="button"
          className={BUTTON}
          aria-label={playing ? t('learn.media.pause') : t('learn.media.play')}
          onClick={toggle}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <input
          type="range"
          dir="ltr"
          className="h-11 min-w-32 flex-1 accent-white"
          aria-label={t('learn.media.seek')}
          aria-valuetext={position}
          min={0}
          max={Math.max(duration, 0)}
          step={1}
          value={Math.min(time, duration)}
          onChange={(e) => seekTo(Number(e.currentTarget.value))}
        />
        <span dir="ltr" aria-hidden="true" className="tabular-nums">
          {clock(time)} / {clock(duration)}
        </span>
        <button
          type="button"
          className={BUTTON}
          aria-label={muted ? t('learn.media.unmute') : t('learn.media.mute')}
          onClick={() => {
            const v = video();
            if (v) v.muted = !v.muted;
          }}
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
        <input
          type="range"
          className="h-11 w-20 accent-white"
          aria-label={t('learn.media.volume')}
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const v = video();
            if (!v) return;
            v.volume = Number(e.currentTarget.value);
            v.muted = v.volume === 0;
          }}
        />
        <label htmlFor={speedId} className="sr-only">
          {t('learn.media.speed')}
        </label>
        <select
          id={speedId}
          className="h-11 rounded-md bg-black/40 px-1 text-white"
          value={String(rate)}
          onChange={(e) => {
            const value = Number(e.currentTarget.value);
            setRate(value);
            const v = video();
            if (v) v.playbackRate = value;
          }}
        >
          {RATES.map((r) => (
            <option key={r} value={String(r)}>
              {r}×
            </option>
          ))}
        </select>
        <button
          type="button"
          className={BUTTON}
          aria-label={fullscreen ? t('learn.media.exitFullscreen') : t('learn.media.fullscreen')}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
