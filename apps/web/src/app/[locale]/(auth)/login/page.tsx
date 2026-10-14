import { LoginForm } from './login-form';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  void params; // the (auth) layout already resolved the locale
  return <LoginForm next={next ?? null} />;
}
