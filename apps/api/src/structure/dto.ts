import {
  CreateLessonSchema,
  CreateModuleSchema,
  type CreateLessonInput,
  ReorderSchema,
  UpdateLessonSchema,
  UpdateModuleSchema,
} from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateModuleDto extends createZodDto(CreateModuleSchema) {}

export class UpdateModuleDto extends createZodDto(UpdateModuleSchema) {}

export class ReorderDto extends createZodDto(ReorderSchema) {}

/**
 * `POST …/modules/{mid}/lessons`: VIDEO / PDF / TEXT (discriminated on `type`). A class cannot
 * extend a union instance type, so the zod DTO is widened (as `AcceptInvitationDto`); its static
 * `schema` is inherited unchanged. Handlers read the body through {@link createLessonInput}.
 */
export class CreateLessonDto extends (createZodDto(
  CreateLessonSchema,
) as unknown as new () => object) {}

/** The validated body of a lesson creation with its union type. */
export const createLessonInput = (dto: CreateLessonDto): CreateLessonInput =>
  dto as CreateLessonInput;

export class UpdateLessonDto extends createZodDto(UpdateLessonSchema) {}
