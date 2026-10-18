import type { LoggerService } from '@nestjs/common';
import { redactPaths } from '@nibras/contracts';
import { pino, type DestinationStream, type Level, type LevelWithSilent, type Logger } from 'pino';

export const WORKER_LOGGER = Symbol('WORKER_LOGGER');

/**
 * Structured JSON logger; secrets and emails (the shared `REDACT_KEYS`, nested up to three levels)
 * are never written in clear. `destination` defaults to stdout (tests pass a memory stream).
 */
export function createLogger(level: LevelWithSilent, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: 'nibras-worker' },
    redact: { paths: redactPaths(), censor: '[REDACTED]' },
  };
  return destination ? pino(options, destination) : pino(options);
}

/** Routes Nest's internal logs through pino. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private write(level: Level, message: unknown, params: unknown[]): void {
    // Nest passes the context (class name) as the last string parameter.
    const last = params.at(-1);
    const context = typeof last === 'string' ? last : undefined;
    if (message instanceof Error) this.logger[level]({ err: message, context }, message.message);
    else this.logger[level]({ context }, String(message));
  }
}
