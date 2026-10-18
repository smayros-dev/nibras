import {
  AuditLogQuerySchema,
  CreateOrganizationSchema,
  TransferOwnershipSchema,
  UpdateWorkspaceSchema,
  WorkspaceSettingsPatchSchema,
} from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateOrganizationDto extends createZodDto(CreateOrganizationSchema) {}

export class UpdateWorkspaceDto extends createZodDto(UpdateWorkspaceSchema) {}

export class WorkspaceSettingsPatchDto extends createZodDto(WorkspaceSettingsPatchSchema) {}

export class TransferOwnershipDto extends createZodDto(TransferOwnershipSchema) {}

export class AuditLogQueryDto extends createZodDto(AuditLogQuerySchema) {}
