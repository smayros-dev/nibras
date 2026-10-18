import { Injectable, type OnModuleInit } from '@nestjs/common';
import { QUEUES } from '@nibras/contracts';
import type { Job } from 'bullmq';

import { ProcessorRegistry } from '../queues';

export const PING_JOB = 'system.ping';

/** Round-trip probe: `system.ping` on `compliance` echoes `msg` back as `pong`. */
@Injectable()
export class PingProcessor implements OnModuleInit {
  constructor(private readonly registry: ProcessorRegistry) {}

  onModuleInit(): void {
    this.registry.registerProcessor(QUEUES.compliance, PING_JOB, (job: Job<{ msg?: unknown }>) =>
      Promise.resolve({ pong: job.data.msg }),
    );
  }
}
