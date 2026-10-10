export interface ShutdownDeps {
  /** Closes the Nest app (runs the lifecycle hooks). */
  close: () => Promise<void>;
  /** Flushes buffered telemetry (spans). */
  flush: () => Promise<void>;
  exit: (code: number) => void;
  logError: (message: string) => void;
  /** Exit 1 if shutdown has not finished by then. */
  timeoutMs: number;
}

/**
 * Signal handler: closes the app, then flushes spans, then exits (0, or 1 if either step failed or
 * shutdown outlived `timeoutMs`). A signal received while shutting down is ignored.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  let exited = false;
  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    deps.exit(code);
  };

  return async (signal) => {
    if (started) return;
    started = true;
    const timer = setTimeout(() => {
      deps.logError(`shutdown on ${signal} timed out after ${deps.timeoutMs}ms`);
      exitOnce(1);
    }, deps.timeoutMs);
    timer.unref();

    let code = 0;
    const attempt = async (step: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run();
      } catch (err) {
        code = 1;
        deps.logError(
          `shutdown on ${signal}: ${step} failed: ${(err as Error)?.stack ?? String(err)}`,
        );
      }
    };
    await attempt('closing the app', deps.close);
    await attempt('flushing spans', deps.flush);
    clearTimeout(timer);
    exitOnce(code);
  };
}
