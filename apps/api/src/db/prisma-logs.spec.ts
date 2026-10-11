import { describe, expect, it, vi } from 'vitest';
import { forwardPrismaLogs } from './prisma-logs';

describe('forwardPrismaLogs', () => {
  it('forwards prisma warn/error events to pino with source and target', () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const h = forwardPrismaLogs(logger as never);
    h('warn', { message: 'slow query', target: 'quaint::pooled', timestamp: new Date() });
    h('error', { message: 'P1001', timestamp: new Date() });
    expect(logger.warn).toHaveBeenCalledWith(
      { source: 'prisma', target: 'quaint::pooled' },
      'slow query',
    );
    expect(logger.error).toHaveBeenCalledWith({ source: 'prisma', target: undefined }, 'P1001');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
