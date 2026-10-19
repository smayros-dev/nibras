/**
 * What the workspace layout renders when `GET /workspaces/{wid}` fails, by error code:
 * - `consent-gate`: `403 CONSENT_REQUIRED` — the account has pending app consents (a version bump,
 *   a freshly registered account). The `/app` layout already renders the ConsentGate over an
 *   inert frame; the workspace layout shows a placeholder under it and the gate's refresh re-runs
 *   the layout once the consents are granted. A 404 here would hide the gate.
 * - `inactive`: the caller's membership is not active (`GUARDIAN_CONSENT_REQUIRED`: a minor waiting
 *   on his guardian; `MEMBERSHIP_INACTIVE`: waiting on approval) — the waiting panel (SP2 §8).
 * - `not-found`: anything else (not a member, unknown workspace, network failure).
 */
export type WorkspaceAccess = 'consent-gate' | 'inactive' | 'not-found';

const INACTIVE_CODES: readonly string[] = ['GUARDIAN_CONSENT_REQUIRED', 'MEMBERSHIP_INACTIVE'];

export function workspaceAccessOnError(code: string | undefined): WorkspaceAccess {
  if (code === 'CONSENT_REQUIRED') return 'consent-gate';
  if (code && INACTIVE_CODES.includes(code)) return 'inactive';
  return 'not-found';
}
