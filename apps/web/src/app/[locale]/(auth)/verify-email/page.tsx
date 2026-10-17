import { VerifyEmailPanel } from './verify-email-panel';

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  void params;
  return <VerifyEmailPanel token={token ?? null} />;
}
