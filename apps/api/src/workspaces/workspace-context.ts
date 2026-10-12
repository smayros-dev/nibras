import { RequestContext, type RequestStore } from '../common/request-context';

/**
 * The workspace and membership `WorkspaceContextGuard` loaded for this `/workspaces/:wid/…`
 * request. Throws when called elsewhere: a wiring bug, never a client error.
 */
export function workspaceContext(): {
  workspace: NonNullable<RequestStore['workspace']>;
  membership: NonNullable<RequestStore['membership']>;
} {
  const store = RequestContext.get();
  if (!store?.workspace || !store.membership) {
    throw new Error('workspaceContext() outside a /workspaces/:wid route');
  }
  return { workspace: store.workspace, membership: store.membership };
}
