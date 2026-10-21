import { CompleteUploadSchema, CreateUploadSchema, MediaQuerySchema } from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateUploadDto extends createZodDto(CreateUploadSchema) {}

export class CompleteUploadDto extends createZodDto(CompleteUploadSchema) {}

export class MediaQueryDto extends createZodDto(MediaQuerySchema) {}
