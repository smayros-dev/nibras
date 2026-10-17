import type { Server } from 'node:http';

/**
 * Idle keep-alive lifetime of API connections. The web app reaches the API through Next's
 * `/api` rewrite, whose proxy reuses keep-alive sockets (Node's global agent). With Node's 5 s
 * server default, the API could close an idle socket at the very moment the proxy sends a request
 * on it: the request fails with ECONNRESET and the browser gets a 500. The server must outlive
 * its clients' idle sockets, so the client side always closes first (the usual load-balancer rule).
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;

export function configureHttpServer(server: Server): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  // Must stay above keepAliveTimeout, or a request arriving on a reused socket can time out.
  server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000;
}
