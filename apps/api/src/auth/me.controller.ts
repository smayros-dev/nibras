import { Controller, Get, Inject } from '@nestjs/common';
import type { MeUser } from '@tt/contracts';
import type { GuardedClient } from '@tt/db';
import type { AuthUser } from '../common/request-context';
import { DB } from '../db/db.module';
import { AllowUnverified } from './decorators/allow-unverified';
import { CurrentUser } from './decorators/current-user';
import { toMeUser } from './me-user';

/**
 * Placeholder `GET /me` (Task 7): `{ user }`, reachable before email verification. Task 11
 * replaces it with the `me` module (profile, consents, computed `twoFactor.required` and
 * `pendingConsents`).
 */
@Controller('me')
export class MeController {
  constructor(@Inject(DB) private readonly db: Pick<GuardedClient, 'user'>) {}

  @AllowUnverified()
  @Get()
  async me(@CurrentUser() current: AuthUser): Promise<{ user: MeUser }> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: current.id } });
    return { user: toMeUser(user, { twoFactorRequired: false, pendingConsents: [] }) };
  }
}
