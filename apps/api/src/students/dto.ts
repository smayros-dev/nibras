import { StudentsQuerySchema, UpdateStudentSchema } from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class StudentsQueryDto extends createZodDto(StudentsQuerySchema) {}

/** `PATCH /workspaces/{wid}/students/{uid}`: a minor's guardian email only (Q1). */
export class UpdateStudentDto extends createZodDto(UpdateStudentSchema) {}
