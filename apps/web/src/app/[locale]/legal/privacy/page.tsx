import { CONSENT_VERSIONS } from '@tt/contracts';
import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '../legal-page';

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return legalMetadata(params, 'privacy');
}

export default function PrivacyPage({ params }: Props) {
  return <LegalPage params={params} document="privacy" version={CONSENT_VERSIONS.PRIVACY} />;
}
