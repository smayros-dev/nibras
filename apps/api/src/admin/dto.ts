import {
  AdminWorkspacesQuerySchema,
  SuspensionSchema,
  UpdateWorkspaceQuotaSchema,
} from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

export class AdminWorkspacesQueryDto extends createZodDto(AdminWorkspacesQuerySchema) {}

export class SuspensionDto extends createZodDto(SuspensionSchema) {}

export class UpdateWorkspaceQuotaDto extends createZodDto(UpdateWorkspaceQuotaSchema) {}
