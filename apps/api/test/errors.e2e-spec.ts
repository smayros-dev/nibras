import { Body, Controller, Get, HttpStatus, Logger, Post } from '@nestjs/common';
import { ApiErrorBodySchema } from '@tt/contracts';
import { createZodDto } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../src/common/api-error';
import { RequestContext } from '../src/common/request-context';
import { createTestApp, type TestAgent } from './helpers/app';

class EchoDto extends createZodDto(z.object({ name: z.string().min(2) })) {}

/** Test-only routes, mounted next to AppModule by this spec alone. */
@Controller('__test')
class TestController {
  @Get('boom')
  boom(): never {
    throw new Error('db password=secret');
  }

  @Post('echo')
  echo(@Body() body: EchoDto): EchoDto {
    return body;
  }

  @Get('domain')
  domain(): never {
    throw new ApiError(HttpStatus.FORBIDDEN, 'PERMISSION_DENIED', 'Nope', { reason: 'role' });
  }

  @Get('context')
  context(): { requestId: string | undefined } {
    return { requestId: RequestContext.get()?.requestId };
  }
}

describe('error envelope', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let http: TestAgent;

  beforeAll(async () => {
    ({ app, http } = await createTestApp({ controllers: [TestController] }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('wraps unknown errors without leaking internals and echoes the request id', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = await http.get('/api/v1/__test/boom').set('X-Request-Id', 'req-123').expect(500);
    expect(res.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal error',
      requestId: 'req-123',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(res.headers['x-request-id']).toBe('req-123');
    // Logged server-side at error level, with the stack.
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('db password=secret'),
      expect.stringContaining('at '),
    );
    logged.mockRestore();
  });

  it('returns 422 VALIDATION_FAILED with field paths', async () => {
    const res = await http.post('/api/v1/__test/echo').send({ name: 'a' }).expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.issues[0].path).toEqual(['name']);
    expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
  });

  it('passes valid bodies through the global zod pipe', async () => {
    await http.post('/api/v1/__test/echo').send({ name: 'ab' }).expect(201, { name: 'ab' });
  });

  it('returns 422 VALIDATION_FAILED for malformed JSON without leaking a stack', async () => {
    const res = await http
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(422);
    expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/\bat \S+:\d+/);
  });

  it('returns 404 NOT_FOUND envelope for unknown routes', async () => {
    const res = await http.get('/api/v1/nope').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(typeof res.body.requestId).toBe('string');
    expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
  });

  it('renders ApiError with its status, code, message and details', async () => {
    const res = await http.get('/api/v1/__test/domain').set('X-Request-Id', 'req-d').expect(403);
    expect(res.body).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'Nope',
      details: { reason: 'role' },
      requestId: 'req-d',
    });
  });

  it('generates a uuid request id when none (or an oversized one) is sent', async () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const res = await http.get('/api/v1/__test/context').expect(200);
    expect(res.headers['x-request-id']).toMatch(uuid);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);

    const long = await http
      .get('/api/v1/__test/context')
      .set('X-Request-Id', 'x'.repeat(129))
      .expect(200);
    expect(long.headers['x-request-id']).toMatch(uuid);
  });
});
