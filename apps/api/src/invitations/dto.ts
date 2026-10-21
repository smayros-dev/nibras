import {
  AcceptInvitationSchema,
  type AcceptInvitationInput,
  CreateInvitationSchema,
  InvitationsQuerySchema,
  UpdateInvitationSchema,
} from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateInvitationDto extends createZodDto(CreateInvitationSchema) {}

export class UpdateInvitationDto extends createZodDto(UpdateInvitationSchema) {}

export class InvitationsQueryDto extends createZodDto(InvitationsQuerySchema) {}

/**
 * `POST /invitations/{token}/accept`: `REGISTER` or `JOIN` (discriminated on `mode`). A class
 * cannot extend a union instance type, so the zod DTO is widened here; its static `schema` (what
 * the validation pipe and the OpenAPI export read) is inherited unchanged. Handlers read the body
 * through {@link acceptInput}.
 */
export class AcceptInvitationDto extends (createZodDto(
  AcceptInvitationSchema,
) as unknown as new () => object) {}

/** The validated body of an acceptance with its union type. */
export const acceptInput = (dto: AcceptInvitationDto): AcceptInvitationInput =>
  dto as AcceptInvitationInput;
