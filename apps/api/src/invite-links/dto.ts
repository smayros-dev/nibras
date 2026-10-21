import {
  AcceptJoinSchema,
  type AcceptJoinInput,
  CreateInviteLinkSchema,
  UpdateInviteLinkSchema,
} from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateInviteLinkDto extends createZodDto(CreateInviteLinkSchema) {}

export class UpdateInviteLinkDto extends createZodDto(UpdateInviteLinkSchema) {}

/**
 * `POST /join/{code}/accept`: `REGISTER` (with the email) or `JOIN` (discriminated on `mode`).
 * Widened like `AcceptInvitationDto` (a class cannot extend a union instance type); handlers read
 * the body through {@link joinInput}.
 */
export class AcceptJoinDto extends (createZodDto(
  AcceptJoinSchema,
) as unknown as new () => object) {}

/** The validated body of a join with its union type. */
export const joinInput = (dto: AcceptJoinDto): AcceptJoinInput => dto as AcceptJoinInput;
