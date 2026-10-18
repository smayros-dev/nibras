import { CONSENT_VERSIONS, testConsentTermsVersion } from '@nibras/contracts/web';
import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '../legal-page';

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return legalMetadata(params, 'terms');
}

/** The version shown is the one the consent gate asks for (same non-production test override). */
export default function TermsPage({ params }: Props) {
  return (
    <LegalPage
      params={params}
      document="terms"
      version={testConsentTermsVersion() ?? CONSENT_VERSIONS.TERMS}
    />
  );
}
