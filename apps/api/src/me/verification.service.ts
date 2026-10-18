import { Injectable } from '@nestjs/common';
import type { TeacherVerification, TeacherVerificationStep } from '@nibras/contracts';
import type { AuthUser } from '../common/request-context';
import { ConsentService } from './consent.service';

/**
 * Teacher verification status (D-O6, PRD §8.1, AC-SAFE-01): verified email, phone verified by
 * SMS code (`phoneVerifiedAt`), and the code of conduct accepted (unrevoked) at the current
 * `CONSENT_VERSIONS.CODE_OF_CONDUCT`. Read per call (one indexed consent query), never cached,
 * so a code-of-conduct version bump applies at the next request.
 */
@Injectable()
export class VerificationService {
  constructor(private readonly consents: ConsentService) {}

  /**
   * `missing` lists the incomplete steps in the order EMAIL, PHONE, CODE_OF_CONDUCT. `user` is
   * the one the guards loaded for this request (fresh from the database).
   */
  async status(
    user: Pick<AuthUser, 'id' | 'emailVerifiedAt' | 'phoneVerifiedAt'>,
  ): Promise<TeacherVerification> {
    const emailVerified = user.emailVerifiedAt !== null;
    const phoneVerified = user.phoneVerifiedAt !== null;
    const codeOfConductAccepted = await this.consents.accepted(user.id, 'CODE_OF_CONDUCT');
    const missing: TeacherVerificationStep[] = [];
    if (!emailVerified) missing.push('EMAIL');
    if (!phoneVerified) missing.push('PHONE');
    if (!codeOfConductAccepted) missing.push('CODE_OF_CONDUCT');
    return { emailVerified, phoneVerified, codeOfConductAccepted, missing };
  }
}
