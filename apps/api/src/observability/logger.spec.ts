import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import type { Options } from 'pino-http';
import { describe, expect, it } from 'vitest';
import { buildPinoOptions } from './logger.module';

const env = { NODE_ENV: 'production', LOG_LEVEL: 'info' } as const;

function httpOptions(params: ReturnType<typeof buildPinoOptions>): Options {
  const { pinoHttp } = params;
  return (Array.isArray(pinoHttp) ? pinoHttp[0] : pinoHttp) as Options;
}

function fakeReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('buildPinoOptions', () => {
  it('redacts credentials and personal data', () => {
    const opts = httpOptions(buildPinoOptions(env));
    const redact = opts.redact as { paths: string[] };
    expect(redact.paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.email',
        '*.token',
      ]),
    );
  });

  it('censors those fields at the top level and nested two levels deep', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const opts = httpOptions(buildPinoOptions(env));
    const logger = pino({ redact: opts.redact }, sink);
    logger.info({
      email: 'a@b.c',
      user: { email: 'a@b.c', password: 'pw', token: 'tok-1' },
      body: { profile: { email: 'a@b.c', cookie: 'sid=1' } },
      req: { headers: { authorization: 'Bearer t', cookie: 'sid=1' } },
    });
    const line = lines.join('');
    expect(line).not.toContain('a@b.c');
    expect(line).not.toContain('pw');
    expect(line).not.toContain('tok-1');
    expect(line).not.toContain('Bearer');
    expect(line).not.toContain('sid=');
  });

  it('logs the request path without its query string', () => {
    const opts = httpOptions(buildPinoOptions(env));
    const serialize = (opts.serializers as { req: (req: unknown) => Record<string, unknown> }).req;
    const out = serialize({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/users?email=a@b.c&token=s3cret',
      query: { email: 'a@b.c', token: 's3cret' },
      params: {},
      headers: { host: 'x' },
      remoteAddress: '::1',
      remotePort: 1,
    });
    expect(out.url).toBe('/api/v1/users');
    expect(out).not.toHaveProperty('query');
    expect(JSON.stringify(out)).not.toMatch(/a@b\.c|s3cret/);
  });

  it('reuses the request id and binds it as request_id', () => {
    const opts = httpOptions(buildPinoOptions(env));
    const req = fakeReq({ 'x-request-id': 'req-42' });
    const res = {} as ServerResponse;
    const id = opts.genReqId?.(req, res);
    expect(id).toBe('req-42');
    req.id = id as string;
    expect(opts.customProps?.(req, res)).toEqual({ request_id: 'req-42' });
    // Called again (e.g. by the request-id middleware), the id stays the same.
    expect(opts.genReqId?.(fakeReq(), res)).not.toBe('req-42');
    expect(opts.genReqId?.(req, res)).toBe('req-42');
  });

  it('tags lines with the service name and the configured level', () => {
    const opts = httpOptions(buildPinoOptions({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }));
    expect(opts.level).toBe('warn');
    expect(opts.base).toEqual({ service: 'tt-api' });
  });

  it('uses the pretty transport only in development', () => {
    expect(httpOptions(buildPinoOptions(env)).transport).toBeUndefined();
    expect(httpOptions(buildPinoOptions({ ...env, NODE_ENV: 'test' })).transport).toBeUndefined();
    expect(
      httpOptions(buildPinoOptions({ ...env, NODE_ENV: 'development' })).transport,
    ).toMatchObject({ target: 'pino-pretty' });
  });

  it('writes to an explicit destination (without transport) when given one', () => {
    const sink = new Writable({ write: (_c, _e, cb) => cb() });
    const { pinoHttp } = buildPinoOptions({ ...env, NODE_ENV: 'development' }, sink);
    expect(Array.isArray(pinoHttp)).toBe(true);
    const [opts, dest] = pinoHttp as [Options, unknown];
    expect(dest).toBe(sink);
    expect(opts.transport).toBeUndefined();
  });

  it('logs 5xx at error, 4xx at warn and the rest at info', () => {
    const opts = httpOptions(buildPinoOptions(env));
    const level = (status: number, err?: Error) =>
      opts.customLogLevel?.(fakeReq(), { statusCode: status } as ServerResponse, err);
    expect(level(200)).toBe('info');
    expect(level(404)).toBe('warn');
    expect(level(503)).toBe('error');
    expect(level(200, new Error('x'))).toBe('error');
  });
});
