import { CONSENT_VERSIONS } from '@tt/contracts/web';
import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '../legal-page';

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return legalMetadata(params, 'codeOfConduct');
}

export default function CodeOfConductPage({ params }: Props) {
  return (
    <LegalPage
      params={params}
      document="codeOfConduct"
      version={CONSENT_VERSIONS.CODE_OF_CONDUCT}
    />
  );
}
