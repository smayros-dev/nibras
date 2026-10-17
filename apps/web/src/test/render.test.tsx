import { useTranslations } from 'next-intl';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRouter } from '../i18n/navigation';
import { mockRouter, renderWithIntl } from './render';

function AppName() {
  const t = useTranslations('common');
  return <p>{t('appName')}</p>;
}

function GoButton() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.push('/app')}>
      go
    </button>
  );
}

describe('renderWithIntl', () => {
  it('renders with fr messages and ltr direction', () => {
    renderWithIntl(<p>{'x'}</p>);
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('uses the ar catalogue and rtl direction for ar', () => {
    renderWithIntl(<AppName />, { locale: 'ar' });
    expect(document.documentElement.dir).toBe('rtl');
    // `common.appName` in ar.json (fr: "Plateforme cours").
    expect(screen.getByText('منصة الدروس')).toBeInTheDocument();
  });

  it('exposes the mocked locale-aware router', () => {
    const router = mockRouter({ pathname: '/app' });
    renderWithIntl(<GoButton />);
    screen.getByRole('button', { name: 'go' }).click();
    expect(router.push).toHaveBeenCalledWith('/app');
  });
});
