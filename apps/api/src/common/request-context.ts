import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request state. SP1 extends it with `user`, `session`, `workspace`, `membership`. */
export interface RequestStore {
  requestId: string;
  ip: string;
  userAgent: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

/** Request-scoped context propagated through async calls (set by `RequestIdMiddleware`). */
export const RequestContext = {
  get(): RequestStore | undefined {
    return storage.getStore();
  },
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },
};
