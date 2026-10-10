import type { NodeSDK } from '@opentelemetry/sdk-node';
import { afterEach, describe, expect, it } from 'vitest';
import { startTracing } from './tracing';

describe('startTracing', () => {
  let sdk: NodeSDK | undefined;
  afterEach(async () => {
    await sdk?.shutdown();
    sdk = undefined;
  });

  it('is off in tests: setup clears OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('does nothing without an OTLP endpoint', () => {
    sdk = startTracing(undefined);
    expect(sdk).toBeUndefined();
  });

  it('starts the SDK when an endpoint is configured', () => {
    sdk = startTracing('http://127.0.0.1:4318');
    expect(sdk).toBeDefined();
  });
});
