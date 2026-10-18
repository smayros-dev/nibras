import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  MethodNotAllowedException,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiErrorBodySchema } from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../src/common/api-error';
import { RequestContext } from '../src/common/request-context';
import { createTestApp, type TestAgent } from './helpers/app';
import { Public } from '../src/auth/decorators/public';

class EchoDto extends createZodDto(z.object({ name: z.string().min(2) })) {}

/** Test-only routes, mounted next to AppModule by this spec alone. */
@Public()
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

  @Get('unauthorized')
  unauthorized(): never {
    throw new UnauthorizedException('token abc expired');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('user 42 lacks role');
  }

  @Get('throttled')
  throttled(): never {
    throw new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
  }

  @Get('not-allowed')
  notAllowed(): never {
    throw new MethodNotAllowedException('internal detail');
  }

  @Get('unavailable')
  unavailable(): never {
    throw new HttpException('upstream x down', HttpStatus.SERVICE_UNAVAILABLE);
  }

  @Get('partial')
  partial(@Res() res: Response): never {
    res.status(200).write('partial');
    throw new Error('failed mid-stream');
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
    expect(res.body.details.issues[0]).toEqual({
      path: ['name'],
      message: expect.any(String),
      code: 'too_small',
      minimum: 2,
      origin: 'string',
    });
    expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
  });

  it('passes valid bodies through the global zod pipe', async () => {
    await http.post('/api/v1/__test/echo').send({ name: 'ab' }).expect(201, { name: 'ab' });
  });

  it('returns 422 VALIDATION_FAILED for malformed JSON without leaking a stack', async () => {
    const res = await http
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":"s3cret-fragment"')
      .expect(422);
    expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Malformed request',
    });
    expect(JSON.stringify(res.body)).not.toContain('s3cret');
    expect(JSON.stringify(res.body)).not.toMatch(/\bat \S+:\d+/);
  });

  it.each([
    ['unauthorized', 401, 'UNAUTHENTICATED'],
    ['forbidden', 403, 'PERMISSION_DENIED'],
    ['throttled', 429, 'RATE_LIMITED'],
    ['not-allowed', 400, 'VALIDATION_FAILED'],
    ['unavailable', 503, 'SERVICE_UNAVAILABLE'],
  ] as const)(
    'maps HTTP errors from /%s to %i %s with a fixed message',
    async (route, status, code) => {
      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const res = await http.get(`/api/v1/__test/${route}`).expect(status);
      expect(res.body.code).toBe(code);
      expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
      // The exception's own message never reaches the client.
      expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'requestId']);
      expect(res.body.message).not.toMatch(/abc|42|Throttler|internal detail|upstream/);
      // Only 5xx are logged at error level (with the stack).
      expect(logged).toHaveBeenCalledTimes(status >= 500 ? 1 : 0);
      logged.mockRestore();
    },
  );

  it('returns 413 PAYLOAD_TOO_LARGE for an oversized JSON body', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = await http
      .post('/api/v1/__test/echo')
      .send({ name: 'x'.repeat(200 * 1024) })
      .expect(413);
    expect(res.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' });
    expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('returns 415 UNSUPPORTED_MEDIA_TYPE for an unsupported body charset', async () => {
    const res = await http
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json; charset=klingon')
      .send('{"name":"ab"}')
      .expect(415);
    expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
  });

  it('ends an already-started response instead of throwing when an error follows', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = await http
      .get('/api/v1/__test/partial')
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (chunk: Buffer) => (data += chunk.toString()));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.body).toBe('partial');
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('failed mid-stream'),
      expect.any(String),
    );
    // The server keeps serving afterwards.
    await http.get('/health/live').expect(200);
    logged.mockRestore();
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

  it('accepts only [A-Za-z0-9._:-] request ids and replaces anything else', async () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const ok = 'Trace-01.abc:def_9';
    const accepted = await http.get('/api/v1/__test/context').set('X-Request-Id', ok).expect(200);
    expect(accepted.headers['x-request-id']).toBe(ok);
    expect(accepted.body.requestId).toBe(ok);

    for (const bad of ['a b', 'id"<script>', 'a/b', 'x;y=1', 'é']) {
      const res = await http.get('/api/v1/__test/context').set('X-Request-Id', bad).expect(200);
      expect(res.headers['x-request-id']).toMatch(uuid);
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    }
  });
});
