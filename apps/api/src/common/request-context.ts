import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  MembershipRole,
  MembershipStatus,
  User,
  WorkspaceStatus,
  WorkspaceType,
} from '@tt/db';

/** The authenticated user as guards load it: never hashes or secrets. */
export type AuthUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'status'
  | 'platformRole'
  | 'locale'
  | 'timezone'
  | 'emailVerifiedAt'
  | 'phoneVerifiedAt'
  | 'totpEnabledAt'
  | 'firstName'
  | 'lastName'
>;

/**
 * Per-request state. `RequestIdMiddleware` opens it with `requestId`/`ip`/`userAgent`; the guards
 * fill the rest by mutating the object `RequestContext.get()` returns (one object per request).
 */
export interface RequestStore {
  requestId: string;
  ip: string;
  userAgent: string;
  user?: AuthUser;
  session?: { id: string; familyId: string };
  workspace?: { id: string; type: WorkspaceType; status: WorkspaceStatus };
  membership?: {
    id: string;
    role: MembershipRole;
    canTeach: boolean;
    status: MembershipStatus;
  };
  /** Set by the permission guard: whether the granted permission covers all rows or only own. */
  permissionScope?: 'all' | 'own';
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
