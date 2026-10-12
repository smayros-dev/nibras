import { SmtpEmailProvider, type EmailProvider } from '@tt/providers';

import type { WorkerEnv } from './env';

/** `EmailProvider` (SMTP from the env; `InMemoryEmailProvider` in tests via `overrideProvider`). */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export function createEmailProvider(
  env: Pick<WorkerEnv, 'SMTP_URL' | 'EMAIL_FROM'>,
): EmailProvider {
  return new SmtpEmailProvider({ smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM });
}
