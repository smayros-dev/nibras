import type { PrismaLogHandler } from '@nibras/db';
import type { PinoLogger } from 'nestjs-pino';

/**
 * Prisma `warn`/`error` log events → pino, tagged `source: 'prisma'` with the engine `target`.
 * The event message is Prisma's own text (no query parameters: query events are not enabled).
 */
export function forwardPrismaLogs(logger: Pick<PinoLogger, 'warn' | 'error'>): PrismaLogHandler {
  return (level, event) => {
    const fields = { source: 'prisma', target: event.target };
    if (level === 'warn') logger.warn(fields, event.message);
    else logger.error(fields, event.message);
  };
}
