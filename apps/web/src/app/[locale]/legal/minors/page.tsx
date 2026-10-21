// A server component: the constant comes from the schema module without reaching a client bundle.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { GUARDIAN_CONSENT_VERSION } from '@nibras/contracts';
import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '../legal-page';

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return legalMetadata(params, 'minors');
}

/**
 * « Notice d'information sur les mineurs » linked from the guardian consent page (PRD §8.3.5):
 * a placeholder until the owner provides the FR/AR/EN text. The version shown is the one a
 * `GUARDIAN_PARENTAL` consent records.
 */
export default function MinorsNoticePage({ params }: Props) {
  return <LegalPage params={params} document="minors" version={GUARDIAN_CONSENT_VERSION} />;
}
