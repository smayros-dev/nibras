/** Rejection of {@link withTimeout} when the budget is exceeded. */
export class TimeoutError extends Error {}

/** `promise`, or a `TimeoutError` after `ms` (a dependency probe never hangs). */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`timeout of ${ms}ms exceeded`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
