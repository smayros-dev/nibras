import {
  AssignmentsQuerySchema,
  CreateAssignmentSchema,
  MembersQuerySchema,
  RemoveMemberSchema,
  UpdateMemberSchema,
} from '@tt/contracts';
import { createZodDto } from 'nestjs-zod';

export class MembersQueryDto extends createZodDto(MembersQuerySchema) {}

export class UpdateMemberDto extends createZodDto(UpdateMemberSchema) {}

/** The body is optional: a bodiless `DELETE` (no `reason`) reaches the pipe as `undefined`. */
export class RemoveMemberDto extends createZodDto(RemoveMemberSchema.default({})) {}

export class AssignmentsQueryDto extends createZodDto(AssignmentsQuerySchema) {}

export class CreateAssignmentDto extends createZodDto(CreateAssignmentSchema) {}
