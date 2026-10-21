import {
  EnrollmentsQuerySchema,
  EnrollStudentsSchema,
  RevokeEnrollmentSchema,
} from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class EnrollStudentsDto extends createZodDto(EnrollStudentsSchema) {}

/** The body is optional: none reads as `{}`. */
export class RevokeEnrollmentDto extends createZodDto(RevokeEnrollmentSchema.default({})) {}

export class EnrollmentsQueryDto extends createZodDto(EnrollmentsQuerySchema) {}
