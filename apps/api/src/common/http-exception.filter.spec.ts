import type { ArgumentsHost } from '@nestjs/common';
import { ApiErrorBodySchema, ValidationIssueSchema } from '@nibras/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HttpExceptionFilter } from './http-exception.filter';
import { ZodValidationException } from './zod-validation.pipe';

/** Runs the filter on `exception` with a minimal express-like response; no Nest app, no DB. */
function render(exception: unknown): { status: number; body: Record<string, unknown> } {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader: () => res,
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return res;
    },
  };
  const req = { headers: { 'x-request-id': 'req-1' } };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return out;
}

function zodFailure(schema: z.ZodType, input: unknown): ZodValidationException {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected a zod failure');
  return new ZodValidationException(result.error);
}

const Probe = z.object({
  email: z.email(),
  password: z.string().min(12),
  age: z.number().max(120),
  name: z.string(),
  tags: z.array(z.string()).min(1),
  kind: z.enum(['A', 'B']),
  code: z.string().refine(() => false, 'nope-custom'),
});

describe('HttpExceptionFilter zod issues', () => {
  it('renders zod issues with code and bounds but never the received value', () => {
    const { status, body } = render(
      zodFailure(Probe, {
        email: 'nope-secret',
        password: 'secret',
        age: 200,
        name: 4242,
        tags: [],
        kind: 'Z-secret',
        code: 'custom-secret',
      }),
    );
    expect(status).toBe(422);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(ApiErrorBodySchema.safeParse(body).success).toBe(true);
    const issues = (body.details as { issues: unknown[] }).issues;
    for (const issue of issues) expect(ValidationIssueSchema.safeParse(issue).success).toBe(true);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['email'], code: 'invalid_format', format: 'email' }),
        expect.objectContaining({
          path: ['password'],
          code: 'too_small',
          minimum: 12,
          origin: 'string',
        }),
        expect.objectContaining({ path: ['age'], code: 'too_big', maximum: 120, origin: 'number' }),
        expect.objectContaining({ path: ['name'], code: 'invalid_type', expected: 'string' }),
        expect.objectContaining({ path: ['tags'], code: 'too_small', minimum: 1, origin: 'array' }),
        expect.objectContaining({ path: ['kind'], code: 'invalid_value' }),
        expect.objectContaining({ path: ['code'], code: 'custom' }),
      ]),
    );
    const json = JSON.stringify(body);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('4242');
    expect(json).not.toContain('"input"');
    expect(json).not.toContain('"received"');
    expect(json).not.toContain('"values"');
  });

  it('keeps only whitelisted keys on every issue', () => {
    const { body } = render(zodFailure(Probe, {}));
    const allowed = new Set([
      'path',
      'message',
      'code',
      'minimum',
      'maximum',
      'origin',
      'expected',
      'format',
    ]);
    for (const issue of (body.details as { issues: Record<string, unknown>[] }).issues) {
      for (const key of Object.keys(issue)) expect(allowed.has(key)).toBe(true);
    }
  });

  it('serialises bigint bounds as numbers and drops non-finite ones', () => {
    const { body } = render(zodFailure(z.object({ n: z.bigint().min(5n) }), { n: 1n }));
    expect((body.details as { issues: unknown[] }).issues).toEqual([
      expect.objectContaining({ path: ['n'], code: 'too_small', minimum: 5, origin: 'bigint' }),
    ]);
  });

  it('gives unrecognized_keys a fixed message that never echoes the client keys', () => {
    const { status, body } = render(
      zodFailure(z.object({ a: z.string() }).strict(), { a: 'x', 'evil<key>': 1 }),
    );
    expect(status).toBe(422);
    expect((body.details as { issues: unknown[] }).issues).toEqual([
      { path: [], message: 'Unrecognized keys', code: 'unrecognized_keys' },
    ]);
    expect(JSON.stringify(body)).not.toContain('evil');
  });

  it('caps string path segments at 64 characters', () => {
    const key = 'k'.repeat(200);
    const { body } = render(zodFailure(z.record(z.string(), z.number()), { [key]: 'x' }));
    const [issue] = (body.details as { issues: { path: unknown[] }[] }).issues;
    expect(issue?.path).toEqual(['k'.repeat(64)]);
  });
});
