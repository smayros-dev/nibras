import {
  AbuseReportsQuerySchema,
  AdminAbuseReportsQuerySchema,
  CreateAbuseReportSchema,
  MyAbuseReportsQuerySchema,
  UpdateAbuseReportSchema,
} from '@tt/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateAbuseReportDto extends createZodDto(CreateAbuseReportSchema) {}

export class MyAbuseReportsQueryDto extends createZodDto(MyAbuseReportsQuerySchema) {}

export class AbuseReportsQueryDto extends createZodDto(AbuseReportsQuerySchema) {}

export class AdminAbuseReportsQueryDto extends createZodDto(AdminAbuseReportsQuerySchema) {}

export class UpdateAbuseReportDto extends createZodDto(UpdateAbuseReportSchema) {}
