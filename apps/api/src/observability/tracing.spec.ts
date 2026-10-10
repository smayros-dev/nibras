import { describe, expect, it } from 'vitest';
import { startTracing } from './tracing';

describe('startTracing', () => {
  it('does nothing without an OTLP endpoint', () => {
    expect(startTracing(undefined)).toBeUndefined();
  });

  it('starts the SDK when an endpoint is configured', async () => {
    const sdk = startTracing('http://127.0.0.1:4318');
    expect(sdk).toBeDefined();
    await sdk?.shutdown();
  });
});
