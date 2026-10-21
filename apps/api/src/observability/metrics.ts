import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Process-wide registry: default Node metrics are registered once, however many Nest apps the
 * process boots (the e2e suite boots several).
 */
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

/** Labelled by route template (`/api/v1/items/:id`), never the raw URL, to bound cardinality. */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, by method, route template and status code',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
});

/**
 * Audit entries that could not be written (`AuditService` never throws to its caller, so this is
 * the alertable signal for a gap in the append-only trail).
 */
export const auditWriteFailures = new Counter({
  name: 'audit_write_failures_total',
  help: 'Audit log entries that failed to be written, by action',
  labelNames: ['action'] as const,
  registers: [metricsRegistry],
});

/**
 * Playback / inline URLs handed out (SP3, D13: logged and metered, never audited), by kind
 * (`HLS`, `MP4`, `PDF`). A spike is the bearer-token sharing signal next to the 30/h window.
 */
export const mediaPlaybackIssued = new Counter({
  name: 'media_playback_issued_total',
  help: 'Media playback URLs issued, by kind',
  labelNames: ['kind'] as const,
  registers: [metricsRegistry],
});

/**
 * Upload outcomes (SP3): `created` (ticket), `completed`, and the refusals at `complete`
 * (`invalid_signature`, `kind_mismatch`, `quota_exceeded`, `size_mismatch`), by media kind.
 */
export const mediaUploads = new Counter({
  name: 'media_uploads_total',
  help: 'Media upload tickets and completions, by kind and outcome',
  labelNames: ['kind', 'outcome'] as const,
  registers: [metricsRegistry],
});
