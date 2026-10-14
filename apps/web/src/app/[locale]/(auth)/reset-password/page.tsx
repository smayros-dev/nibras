import { ResetPasswordForm } from './reset-password-form';

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  void params;
  return <ResetPasswordForm token={token ?? null} />;
}
