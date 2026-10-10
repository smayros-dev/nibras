import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Logger } from 'pino';

import { WORKER_ENV, type WorkerEnv } from './env';
import { WORKER_LOGGER } from './logger';
import { QueueRegistry } from './queues';

/** Plain `node:http` probes: `/health/live` (process up), `/health/ready` (Redis + workers). */
@Injectable()
export class HealthServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly server: Server;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
    private readonly queues: QueueRegistry,
  ) {
    this.server = createServer((req, res) => {
      void this.route(req.method, req.url).then(([status, body]) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.env.WORKER_PORT, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.logger.info({ port: this.port() }, 'health server listening');
  }

  /** The bound port (differs from `WORKER_PORT` when that is `0`). */
  port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.server.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async route(method = 'GET', url = '/'): Promise<[number, object]> {
    if (method !== 'GET' && method !== 'HEAD') return [405, { status: 'method_not_allowed' }];
    const path = url.split('?')[0];
    if (path === '/health/live') return [200, { status: 'ok' }];
    if (path === '/health/ready') {
      const ready = await this.queues.isReady().catch(() => false);
      return ready ? [200, { status: 'ok' }] : [503, { status: 'unavailable' }];
    }
    return [404, { status: 'not_found' }];
  }
}
