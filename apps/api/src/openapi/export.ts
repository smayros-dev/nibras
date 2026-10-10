import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from '../app.module';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../app.setup';

/** Committed contract, consumed by `@tt/contracts` (`generate` → `src/generated/api.d.ts`). */
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

/** `pnpm --filter @tt/api openapi:export`: builds the app without listening and writes the file. */
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
