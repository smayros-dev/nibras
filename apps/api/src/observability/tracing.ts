import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { env } from '../config/env';

/**
 * Starts OpenTelemetry tracing (OTLP over HTTP, auto-instrumentations) when an endpoint is
 * configured; returns `undefined`, doing nothing, otherwise. The exporter reads
 * `OTEL_EXPORTER_OTLP_ENDPOINT` itself and appends `/v1/traces`. Traces only: metrics are served
 * by Prometheus (`/metrics`) and logs by pino, so the SDK's env-default OTLP metric and log
 * exporters are turned off (OTLP logs would bypass pino's redaction).
 */
export function startTracing(endpoint: string | undefined): NodeSDK | undefined {
  if (!endpoint) return undefined;
  const sdk = new NodeSDK({
    serviceName: 'tt-api',
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs spans are pure noise for an HTTP API.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Keep trace ids on pino lines, but never forward the lines themselves.
        '@opentelemetry/instrumentation-pino': { disableLogSending: true },
      }),
    ],
  });
  sdk.start();
  return sdk;
}

/**
 * Imported first by `main.ts`: instrumentation must patch `http`, `express`, `ioredis`, ... before
 * they are loaded.
 */
const sdk = startTracing(env.OTEL_EXPORTER_OTLP_ENDPOINT);

/** Flushes buffered spans; a no-op when tracing is off. */
export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
}
