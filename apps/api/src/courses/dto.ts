import {
  CoursesQuerySchema,
  CreateCourseSchema,
  ReassignCourseSchema,
  UpdateCourseSchema,
} from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class CoursesQueryDto extends createZodDto(CoursesQuerySchema) {}

export class CreateCourseDto extends createZodDto(CreateCourseSchema) {}

export class UpdateCourseDto extends createZodDto(UpdateCourseSchema) {}

export class ReassignCourseDto extends createZodDto(ReassignCourseSchema) {}
