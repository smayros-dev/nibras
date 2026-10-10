import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShutdownHandler, type ShutdownDeps } from './shutdown';

function deps(overrides: Partial<ShutdownDeps> = {}): ShutdownDeps {
  return {
    close: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    exit: vi.fn(),
    logError: vi.fn(),
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe('createShutdownHandler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the app, then flushes spans, then exits 0', async () => {
    const order: string[] = [];
    const d = deps({
      close: vi.fn(async () => void order.push('close')),
      flush: vi.fn(async () => void order.push('flush')),
      exit: vi.fn((code: number) => void order.push(`exit ${code}`)),
    });
    await createShutdownHandler(d)('SIGTERM');
    expect(order).toEqual(['close', 'flush', 'exit 0']);
    expect(d.logError).not.toHaveBeenCalled();
  });

  it('logs and exits 1 when closing the app fails, still flushing spans', async () => {
    const d = deps({ close: vi.fn(async () => Promise.reject(new Error('close failed'))) });
    await createShutdownHandler(d)('SIGTERM');
    expect(d.flush).toHaveBeenCalledOnce();
    expect(d.logError).toHaveBeenCalledWith(expect.stringContaining('close failed'));
    expect(d.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('logs and exits 1 when the span flush fails', async () => {
    const d = deps({ flush: vi.fn(async () => Promise.reject(new Error('flush failed'))) });
    await createShutdownHandler(d)('SIGINT');
    expect(d.logError).toHaveBeenCalledWith(expect.stringContaining('flush failed'));
    expect(d.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('ignores a second signal while shutting down', async () => {
    const d = deps();
    const handle = createShutdownHandler(d);
    await Promise.all([handle('SIGTERM'), handle('SIGINT')]);
    expect(d.close).toHaveBeenCalledOnce();
    expect(d.exit).toHaveBeenCalledOnce();
  });

  it('forces exit 1 when shutdown hangs past the timeout', async () => {
    vi.useFakeTimers();
    const d = deps({ close: vi.fn(() => new Promise<void>(() => undefined)), timeoutMs: 500 });
    void createShutdownHandler(d)('SIGTERM');
    await vi.advanceTimersByTimeAsync(499);
    expect(d.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(d.logError).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    expect(d.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
