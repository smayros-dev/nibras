import type { ApiErrorBody, JoinPreview } from '@nibras/contracts';
import { Button } from '@nibras/ui';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '../../../../../components/auth-card';
import { JoinForm } from '../../../../../components/join-form';
import { Link } from '../../../../../i18n/navigation';
import { asApiResult, serverApi } from '../../../../../lib/api';

/** `410` codes of `GET /join/{code}` (their `errors.*` message is the description). */
const GONE_CODES = ['INVITE_LINK_DISABLED', 'INVITE_LINK_EXHAUSTED', 'INVITE_LINK_EXPIRED'];

/**
 * Public join page of a group code (PRD §8.3.3, D-P18; SP2 design §8). The preview is read
 * server-side with the visitor's cookies (anonymous → register form, signed in → confirmation).
 * Unknown codes (`404`) and disabled, used-up or expired ones (`410`) end on a message. The code
 * is a group secret: it is only sent to the API (whose logs mask the path).
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { code } = await params; // the (public) layout already resolved the locale
  const t = await getTranslations();

  let preview: JoinPreview | undefined;
  let error: ApiErrorBody | undefined;
  let status = 0;
  try {
    const result = await (await serverApi()).GET('/join/{code}', { params: { path: { code } } });
    status = result.response.status;
    ({ data: preview, error } = asApiResult<JoinPreview>(result));
  } catch {
    // API unreachable: the generic "unavailable" card below.
  }
  if (preview) return <JoinForm key={preview.viewer} code={code} preview={preview} />;

  const errorCode = error?.code ?? '';
  let title = t('invite.unavailable');
  let description = t('errors.SERVICE_UNAVAILABLE');
  if (status === 404) {
    title = t('join.invalid');
    description = t('join.invalidHint');
  } else if (GONE_CODES.includes(errorCode)) {
    title = t('join.unavailable');
    description = t(`errors.${errorCode}`);
  } else if (errorCode === 'RATE_LIMITED') {
    description = t('errors.RATE_LIMITED');
  }
  return (
    <AuthCard title={title} description={description}>
      <Button variant="primary" asChild>
        <Link href="/">{t('invite.home')}</Link>
      </Button>
    </AuthCard>
  );
}
