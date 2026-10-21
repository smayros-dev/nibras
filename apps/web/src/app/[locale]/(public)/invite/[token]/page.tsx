import type { ApiErrorBody, InvitationPreview } from '@nibras/contracts';
import { Button } from '@nibras/ui';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '../../../../../components/auth-card';
import { InvitationAcceptForm } from '../../../../../components/invitation-accept-form';
import { Link } from '../../../../../i18n/navigation';
import { asApiResult, serverApi } from '../../../../../lib/api';

/** `410` codes of `GET /invitations/{token}` and the page title each one gets. */
const GONE_TITLES: Record<string, string> = {
  INVITATION_EXPIRED: 'invite.expired',
  INVITATION_REVOKED: 'invite.revoked',
  INVITATION_ALREADY_ACCEPTED: 'invite.accepted',
  TOKEN_INVALID: 'invite.invalid',
};

/**
 * Public invitation page (PRD §8.1.1, D-P18; SP2 design §8). The preview is read server-side with
 * the visitor's cookies, so `viewer` (anonymous / the invited address / another one) is known at
 * first paint. Expired, revoked, used and unknown links end on a message (« Invitation expirée —
 * demandez à votre professeur de la renvoyer »). The raw token is only sent to the API (whose logs
 * mask the path); `Referrer-Policy: no-referrer` keeps it out of outgoing requests.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token } = await params; // the (public) layout already resolved the locale
  const t = await getTranslations();

  let preview: InvitationPreview | undefined;
  let error: ApiErrorBody | undefined;
  try {
    const result = asApiResult<InvitationPreview>(
      await (await serverApi()).GET('/invitations/{token}', { params: { path: { token } } }),
    );
    preview = result.data;
    error = result.error;
  } catch {
    // API unreachable: the generic "unavailable" card below.
  }
  // A new viewer (after « Se déconnecter et continuer ») is a new form: no state carried over.
  if (preview) return <InvitationAcceptForm key={preview.viewer} token={token} preview={preview} />;

  const code = error?.code ?? '';
  const titleKey = GONE_TITLES[code];
  return (
    <AuthCard
      title={titleKey ? t(titleKey) : t('invite.unavailable')}
      description={
        code === 'INVITATION_ALREADY_ACCEPTED'
          ? t('invite.acceptedHint')
          : titleKey
            ? t('invite.goneHint')
            : t(code === 'RATE_LIMITED' ? 'errors.RATE_LIMITED' : 'errors.SERVICE_UNAVAILABLE')
      }
    >
      <Button variant="primary" asChild>
        {code === 'INVITATION_ALREADY_ACCEPTED' ? (
          <Link href="/login">{t('invite.login')}</Link>
        ) : (
          <Link href="/">{t('invite.home')}</Link>
        )}
      </Button>
    </AuthCard>
  );
}
