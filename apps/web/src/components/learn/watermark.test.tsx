import { act, render, screen } from '@testing-library/react';
import { WATERMARK_MOVE_MS, WATERMARK_POSITIONS } from '@nibras/contracts/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Watermark } from './watermark';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 21, 9, 5, 30));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Watermark (D-O8)', () => {
  it('shows the viewer email and the local time, hidden from assistive technology', () => {
    render(<Watermark text="lina@example.tn" />);
    const mark = screen.getByTestId('watermark');
    expect(mark).toHaveTextContent('lina@example.tn · 09:05');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark.className).toContain('pointer-events-none');
    expect(mark.className).toContain('select-none');
    expect(mark.querySelector('a, button, input, [tabindex]')).toBeNull();
    // Positioned by class only: an inline style would be refused by the CSP.
    expect(mark).not.toHaveAttribute('style');
  });

  it(`moves every ${WATERMARK_MOVE_MS / 1000} s and wraps after ${WATERMARK_POSITIONS} positions`, () => {
    render(<Watermark text="lina@example.tn" />);
    const mark = screen.getByTestId('watermark');
    expect(mark).toHaveAttribute('data-position', '0');
    const seen = new Set([mark.className]);
    for (let i = 1; i < WATERMARK_POSITIONS; i += 1) {
      act(() => {
        vi.advanceTimersByTime(WATERMARK_MOVE_MS);
      });
      expect(mark).toHaveAttribute('data-position', String(i));
      seen.add(mark.className);
    }
    expect(seen.size).toBe(WATERMARK_POSITIONS);
    act(() => {
      vi.advanceTimersByTime(WATERMARK_MOVE_MS);
    });
    expect(mark).toHaveAttribute('data-position', '0');
  });

  it('refreshes the time every minute', () => {
    render(<Watermark text="lina@example.tn" />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('watermark')).toHaveTextContent('lina@example.tn · 09:06');
  });
});
