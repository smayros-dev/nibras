import type { ApiErrorBody, GuardianView } from '@nibras/contracts';
import { Button } from '@nibras/ui';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '../../../../../components/auth-card';
import { GuardianPanel } from '../../../../../components/guardian-panel';
import { Link } from '../../../../../i18n/navigation';
import { asApiResult, serverApi } from '../../../../../lib/api';

/**
 * Public guardian page (PRD §8.3.5, D-O5; AC-INV-11, AC-SAFE-06; SP2 design §8): one (student,
 * workspace) — the consent's state, that workspace's sessions of that student (SP5), revoke and
 * re-grant. The long-lived token from the confirmation email is the only credential; a re-grant
 * replaces it, so an old link (`410 TOKEN_INVALID`) points to the most recent email. The raw
 * token is only sent to the API (whose logs mask the path).
 */
export default async function GuardianPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token } = await params; // the (public) layout already resolved the locale
  const t = await getTranslations();

  let view: GuardianView | undefined;
  let error: ApiErrorBody | undefined;
  try {
    const result = asApiResult<GuardianView>(
      await (await serverApi()).GET('/guardian/{token}', { params: { path: { token } } }),
    );
    view = result.data;
    error = result.error;
  } catch {
    // API unreachable: the generic "unavailable" card below.
  }
  // A new state (after revoke / re-grant, `router.refresh()`) re-renders with fresh props.
  if (view) return <GuardianPanel key={view.link.status} token={token} view={view} />;

  const code = error?.code ?? '';
  const invalid = code === 'TOKEN_INVALID';
  return (
    <AuthCard
      title={invalid ? t('guardian.pageInvalid') : t('guardian.unavailable')}
      description={
        invalid
          ? t('guardian.pageInvalidHint')
          : t(code === 'RATE_LIMITED' ? 'errors.RATE_LIMITED' : 'errors.SERVICE_UNAVAILABLE')
      }
    >
      <Button variant="secondary" asChild>
        <Link href="/">{t('invite.home')}</Link>
      </Button>
    </AuthCard>
  );
}
