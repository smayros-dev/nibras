'use client';

import { WATERMARK_MOVE_MS } from '@nibras/contracts/web';
import { useEffect, useState } from 'react';

/**
 * One class per position (`WATERMARK_POSITIONS` = 6), in visiting order: corners and mid-sides,
 * so that no fixed crop of the frame hides the mark. Classes, not an inline `style` (kept off the
 * policy's `'unsafe-inline'` residual, see the frontend runbook): six spots need no more.
 */
const POSITIONS = [
  'top-[6%] start-[5%]',
  'top-[42%] end-[8%]',
  'bottom-[14%] start-[12%]',
  'top-[8%] end-[6%]',
  'top-[46%] start-[20%]',
  'bottom-[16%] end-[10%]',
] as const;

function clock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The visible watermark of D-O8 (no DRM): the viewer's email and the time, moved every
 * `WATERMARK_MOVE_MS`. Purely decorative for assistive technology and never in the way of a click
 * or a selection. The parent is the positioning context (the player's fullscreen element, the PDF
 * frame), so the mark survives fullscreen.
 */
export function Watermark({ text }: { text: string }) {
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setTick((n) => (n + 1) % POSITIONS.length);
      setNow(new Date());
    }, WATERMARK_MOVE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      data-testid="watermark"
      data-position={tick}
      className={`pointer-events-none absolute z-10 select-none rounded-sm bg-black/20 px-2 py-0.5 font-mono text-xs text-white opacity-40 transition-all duration-1000 sm:text-sm ${POSITIONS[tick]}`}
    >
      {text} · {clock(now)}
    </div>
  );
}
