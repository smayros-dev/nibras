import { ImportQuerySchema, ImportRequestSchema } from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

/** `POST /workspaces/{wid}/invitations/import`: `{ fileName, content }` (the CSV as text, ≤ 1 MiB). */
export class ImportRequestDto extends createZodDto(ImportRequestSchema) {}

/** `?dryRun=true|false` (default `false`), read as a boolean. */
export class ImportQueryDto extends createZodDto(ImportQuerySchema) {}
