import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from '../app.module';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../app.setup';

/** Committed contract, consumed by `@nibras/contracts` (`generate` → `src/generated/api.d.ts`). */
const OUTPUT = resolve(__dirname, '../../../../packages/contracts/openapi/openapi.json');

/**
 * The API's OpenAPI document. Paths are relative to the `/api/v1` server; the few routes served
 * outside the prefix (health) override it with `/` at the path level.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('TT API')
    .setVersion('1')
    .addServer(`/${API_PREFIX}`)
    .build();
  const doc = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, config, { ignoreGlobalPrefix: true }),
  );
  for (const route of UNPREFIXED_ROUTES) {
    const item = doc.paths[`/${route}`];
    if (item) item.servers = [{ url: '/' }];
  }
  return doc;
}

/** One registered HTTP route: upper-case method and the path as Express stores it. */
export interface RouteInfo {
  method: string;
  path: string;
}

/** The bits of an Express layer this walk needs; the real objects are not typed by `@types/express`. */
interface ExpressLayer {
  route?: { path: string | string[] | RegExp; methods: Record<string, boolean | undefined> };
  name?: string;
  handle?: { stack?: ExpressLayer[] };
}

/**
 * Every route the app's Express router serves, as `{ method, path }` — the enumeration behind
 * the generic tenant-isolation suite (`test/isolation`), which must cover every
 * `/workspaces/{wid}` route a routing refactor might add or rename. Walks the router stack that
 * Nest registered the (globally prefixed) routes on, recursing into mounted sub-routers.
 */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack?: ExpressLayer[] };
    _router?: { stack?: ExpressLayer[] };
  };
  const stack = (instance.router ?? instance._router)?.stack;
  if (!stack) throw new Error('listRoutes: Express router stack not found');

  const out: RouteInfo[] = [];
  const walk = (layers: ExpressLayer[]): void => {
    for (const layer of layers) {
      const route = layer.route;
      if (route) {
        const paths = Array.isArray(route.path) ? route.path : [route.path];
        for (const path of paths) {
          if (typeof path !== 'string') continue;
          for (const [method, enabled] of Object.entries(route.methods)) {
            if (enabled && method !== '_all') {
              out.push({ method: method.toUpperCase(), path });
            }
          }
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(stack);
  return out;
}

/** 2-space JSON with recursively sorted keys and a trailing newline, so CI can diff it. */
export function toStableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

/** `pnpm --filter @nibras/api openapi:export`: builds the app without listening and writes the file. */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await writeFile(OUTPUT, toStableJson(buildOpenApiDocument(app)));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
