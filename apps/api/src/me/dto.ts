import { ConsentTypeParamSchema, GrantConsentSchema, UpdateMeSchema } from '@tt/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateMeDto extends createZodDto(UpdateMeSchema) {}

export class ConsentTypeParamDto extends createZodDto(ConsentTypeParamSchema) {}

export class GrantConsentDto extends createZodDto(GrantConsentSchema) {}
