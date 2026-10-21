import { GuardianDecisionSchema, GuardianRegrantSchema } from '@nibras/contracts';
import { createZodDto } from 'nestjs-zod';

/** Public `POST /guardian-consent/{token}`: `GRANT` (minors notice required) or `REFUSE`. */
export class GuardianDecisionDto extends createZodDto(GuardianDecisionSchema) {}

/** Public `POST /guardian/{token}/grant`: a re-grant after a revocation or a refusal. */
export class GuardianRegrantDto extends createZodDto(GuardianRegrantSchema) {}
