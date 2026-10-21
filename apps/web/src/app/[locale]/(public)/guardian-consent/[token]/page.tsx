import type { ApiErrorBody, GuardianConsentPreview } from '@nibras/contracts';
import { Button } from '@nibras/ui';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '../../../../../components/auth-card';
import { GuardianConsentForm } from '../../../../../components/guardian-consent-form';
import { Link } from '../../../../../i18n/navigation';
import { asApiResult, serverApi } from '../../../../../lib/api';

/**
 * Public parental consent page (PRD §8.3.5, D-O5; AC-INV-10; SP2 design §8): the guardian has no
 * account, the emailed token is the only credential. A pending request renders the grant / refuse
 * form; an expired one says to ask the teacher again; a used, replaced or unknown one (`410
 * TOKEN_INVALID` — a decision clears the token) says a response was already given. The raw token
 * is only sent to the API (whose logs mask the path); `Referrer-Policy: no-referrer` keeps it out
 * of outgoing requests (the minors notice opens in a new tab).
 */
export default async function GuardianConsentPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token } = await params; // the (public) layout already resolved the locale
  const t = await getTranslations();

  let preview: GuardianConsentPreview | undefined;
  let error: ApiErrorBody | undefined;
  try {
    const result = asApiResult<GuardianConsentPreview>(
      await (await serverApi()).GET('/guardian-consent/{token}', { params: { path: { token } } }),
    );
    preview = result.data;
    error = result.error;
  } catch {
    // API unreachable: the generic "unavailable" card below.
  }
  if (preview) return <GuardianConsentForm token={token} preview={preview} />;

  const code = error?.code ?? '';
  let title = t('guardian.unavailable');
  let description = t(
    code === 'RATE_LIMITED' ? 'errors.RATE_LIMITED' : 'errors.SERVICE_UNAVAILABLE',
  );
  if (code === 'CONSENT_LINK_EXPIRED') {
    title = t('guardian.expired');
    description = t('guardian.expiredHint');
  } else if (code === 'CONSENT_ALREADY_DECIDED' || code === 'TOKEN_INVALID') {
    title = t('guardian.decided');
    description = t('guardian.decidedHint');
  }
  return (
    <AuthCard title={title} description={description}>
      <Button variant="secondary" asChild>
        <Link href="/">{t('invite.home')}</Link>
      </Button>
    </AuthCard>
  );
}
