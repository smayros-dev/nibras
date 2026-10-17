import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { configureHttpServer, KEEP_ALIVE_TIMEOUT_MS } from './http-server';

describe('configureHttpServer', () => {
  it('keeps idle connections open longer than the clients that reuse them', () => {
    const server = createServer();
    configureHttpServer(server);
    // Node's default (5 s) equals the keep-alive agent's idle timeout of the web proxy: the API
    // could close a socket the proxy is reusing at that instant (ECONNRESET -> 500).
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(5_000);
    // headersTimeout must exceed keepAliveTimeout or Node may drop the next request's headers.
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });
});
