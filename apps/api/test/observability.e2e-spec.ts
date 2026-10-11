import {
  CanActivate,
  Controller,
  Get,
  HttpStatus,
  Param,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error';
import { buildOpenApiDocument, toStableJson } from '../src/openapi/export';
import { createTestApp, type CapturedLogs, type TestAgent } from './helpers/app';

/** Test-only routes, mounted next to AppModule by this spec alone. */
@Controller('__obs')
class ObsController {
  @Get('items/:id')
  item(@Param('id') id: string): { id: string } {
    return { id };
  }

  @Get('boom')
  boom(): never {
    throw new Error('kaboom');
  }
}

class RejectingGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'nope');
  }
}

/** A route whose guard always rejects: the handler never runs. */
@Controller('__test')
class GuardedProbeController {
  @Get('guarded')
  @UseGuards(RejectingGuard)
  guarded(): { ok: true } {
    return { ok: true };
  }
}

describe('observability', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let http: TestAgent;
  let logs: CapturedLogs;

  beforeAll(async () => {
    ({ app, http, logs } = await createTestApp({
      controllers: [ObsController, GuardedProbeController],
    }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    logs.clear();
  });

  it('serves prometheus metrics with the request duration histogram', async () => {
    await http.get('/health/live');
    const res = await http.get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toContain('process_cpu_seconds_total');
  });

  it('serves metrics outside the /api/v1 prefix', async () => {
    await http.get('/api/v1/metrics').expect(404);
  });

  it('labels request durations with the route template, not the raw url', async () => {
    await http.get('/api/v1/__obs/items/12345').expect(200);
    const res = await http.get('/metrics').expect(200);
    expect(res.text).toMatch(
      /http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/__obs\/items\/:id",status="200"\} \d+/,
    );
    expect(res.text).not.toContain('12345');
  });

  it('records the final status of failed requests', async () => {
    await http.get('/api/v1/__obs/boom').expect(500);
    const res = await http.get('/metrics').expect(200);
    expect(res.text).toMatch(/route="\/api\/v1\/__obs\/boom",status="500"/);
  });

  it('requests rejected by a guard or by routing are measured', async () => {
    await http.get('/api/v1/__test/guarded').expect(401);
    await http.get('/api/v1/nope').expect(404);
    const metrics = (await http.get('/metrics').expect(200)).text;
    expect(metrics).toMatch(
      /http_request_duration_seconds_count\{[^}]*route="\/api\/v1\/__test\/guarded"[^}]*status="401"/,
    );
    expect(metrics).toMatch(/route="unknown"[^}]*status="404"/);
    // Unknown routes are never labelled with the raw url (cardinality) or the middleware mount.
    expect(metrics).not.toContain('route="/api/v1/nope"');
    expect(metrics).not.toContain('splat');
  });

  it('labels unprefixed routes by template and never labels an unknown path by its url', async () => {
    await http.get('/health/live').expect(200);
    await http.get('/nope-outside').expect(404);
    const metrics = (await http.get('/metrics').expect(200)).text;
    expect(metrics).toMatch(/route="\/health\/live",status="200"/);
    expect(metrics).not.toContain('nope-outside');
    expect(metrics).not.toContain('splat');
  });

  it('writes one JSON request log line carrying request_id, with credentials redacted', async () => {
    await http
      .get('/health/live')
      .set('X-Request-Id', 'obs-1')
      .set('Authorization', 'Bearer s3cret')
      .set('Cookie', 'sid=s3cret')
      .expect(200);
    const line = logs.lines().find((l) => l.msg === 'request completed');
    expect(line).toMatchObject({ service: 'tt-api', request_id: 'obs-1', level: 30 });
    // Only the status of the response: its headers (helmet, CORS) would repeat on every line.
    expect(line?.res).toEqual({ statusCode: 200 });
    expect(JSON.stringify(logs.lines())).not.toContain('s3cret');
  });

  it('never logs query string values (emails, tokens)', async () => {
    await http
      .get('/health/live?email=a@b.c&token=s3cret')
      .set('X-Request-Id', 'obs-q')
      .expect(200);
    const lines = logs.lines();
    expect(lines.find((l) => l.request_id === 'obs-q')).toMatchObject({
      req: { url: '/health/live' },
    });
    const text = JSON.stringify(lines);
    expect(text).not.toContain('a@b.c');
    expect(text).not.toContain('s3cret');
  });

  it('logs 5xx with the stack and the request id through pino', async () => {
    await http.get('/api/v1/__obs/boom').set('X-Request-Id', 'obs-2').expect(500);
    const error = logs.lines().find((l) => l.context === 'HttpExceptionFilter');
    expect(error).toMatchObject({ level: 50, request_id: 'obs-2' });
    expect((error?.err as { stack?: string } | undefined)?.stack).toContain('kaboom');
  });

  it('logs 4xx at debug without a stack', async () => {
    await http.get('/api/v1/nope').set('X-Request-Id', 'obs-3').expect(404);
    const lines = logs.lines().filter((l) => l.context === 'HttpExceptionFilter');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 20, request_id: 'obs-3' });
    expect(lines[0]?.err).toBeUndefined();
  });

  it('openapi document lists the health routes under the /api/v1 server', async () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.info.title).toBe('TT API');
    expect(doc.info.version).toBe('1');
    expect(doc.servers?.[0]?.url).toBe('/api/v1');
    expect(doc.paths['/health/live']).toBeDefined();
    expect(doc.paths['/health/ready']).toBeDefined();
    // Health lives outside the prefix: its path item overrides the server.
    expect(doc.paths['/health/live']?.servers).toEqual([{ url: '/' }]);
    // Prefixed routes are listed relative to the /api/v1 server.
    expect(doc.paths['/__obs/items/{id}']).toBeDefined();
    expect(doc.paths['/__obs/items/{id}']?.servers).toBeUndefined();
    expect(doc.paths['/metrics']).toBeUndefined();
  });

  it('serializes the openapi document deterministically', () => {
    const json = toStableJson(buildOpenApiDocument(app));
    expect(json).toBe(toStableJson(JSON.parse(json)));
    expect(json.endsWith('}\n')).toBe(true);
    const keys = Object.keys(JSON.parse(json) as object);
    expect(keys).toEqual([...keys].sort());
  });
});
