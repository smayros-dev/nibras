import {
  CreateInvitationSchema,
  InvitationsQuerySchema,
  UpdateInvitationSchema,
} from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateInvitationDto extends createZodDto(CreateInvitationSchema) {}

export class UpdateInvitationDto extends createZodDto(UpdateInvitationSchema) {}

export class InvitationsQueryDto extends createZodDto(InvitationsQuerySchema) {}
