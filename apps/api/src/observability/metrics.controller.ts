import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { metricsRegistry } from './metrics';

/** Prometheus scrape endpoint, served outside the `/api/v1` prefix and the OpenAPI document. */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', metricsRegistry.contentType)
  @Header('Cache-Control', 'no-store')
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
