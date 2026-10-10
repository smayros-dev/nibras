/**
 * Global validation pipe: nestjs-zod validates every `createZodDto(schema)` argument and
 * throws `ZodValidationException`, which `HttpExceptionFilter` renders as 422 VALIDATION_FAILED.
 */
export { ZodValidationPipe, ZodValidationException, createZodDto } from 'nestjs-zod';
