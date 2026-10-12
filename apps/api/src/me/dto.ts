import {
  ConsentTypeParamSchema,
  GrantConsentSchema,
  PhoneOtpRequestSchema,
  PhoneOtpVerifySchema,
  UpdateMeSchema,
} from '@tt/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateMeDto extends createZodDto(UpdateMeSchema) {}

export class ConsentTypeParamDto extends createZodDto(ConsentTypeParamSchema) {}

export class GrantConsentDto extends createZodDto(GrantConsentSchema) {}

export class PhoneOtpRequestDto extends createZodDto(PhoneOtpRequestSchema) {}

export class PhoneOtpVerifyDto extends createZodDto(PhoneOtpVerifySchema) {}
