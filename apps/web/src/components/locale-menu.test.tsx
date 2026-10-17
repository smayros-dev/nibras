import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { LocaleMenu } from './locale-menu';

afterEach(() => {
  document.cookie = 'tt_locale=; path=/; max-age=0';
});

describe('LocaleMenu', () => {
  it('lists every locale in its own script with the current one checked', async () => {
    const ue = userEvent.setup();
    renderWithIntl(<LocaleMenu />, { locale: 'ar' });
    const trigger = screen.getByRole('button', { name: tr('ar', 'shell.language') });
    trigger.focus();
    await ue.keyboard('{Enter}');
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['Français', 'العربية', 'English']);
    expect(screen.getByRole('menuitemradio', { name: 'العربية' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveAttribute('lang', 'fr');
  });

  it('switches the current page to the chosen locale and stores it in tt_locale', async () => {
    const ue = userEvent.setup();
    const router = mockRouter({ pathname: '/app/settings/profile' });
    renderWithIntl(<LocaleMenu />);
    await ue.click(screen.getByRole('button', { name: tr('fr', 'shell.language') }));
    await ue.click(screen.getByRole('menuitemradio', { name: 'العربية' }));
    expect(router.replace).toHaveBeenCalledWith('/app/settings/profile', { locale: 'ar' });
    expect(document.cookie).toContain('tt_locale=ar');
  });

  it('keeps the query string and hash', async () => {
    const ue = userEvent.setup();
    window.history.replaceState(null, '', '/fr/admin/abuse-reports?status=OPEN&page=2#list');
    const router = mockRouter({ pathname: '/admin/abuse-reports' });
    renderWithIntl(<LocaleMenu />);
    await ue.click(screen.getByRole('button', { name: tr('fr', 'shell.language') }));
    await ue.click(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(router.replace).toHaveBeenCalledWith('/admin/abuse-reports?status=OPEN&page=2#list', {
      locale: 'en',
    });
    window.history.replaceState(null, '', '/');
  });

  it('does nothing when the current locale is chosen again', async () => {
    const ue = userEvent.setup();
    const router = mockRouter({ pathname: '/app' });
    renderWithIntl(<LocaleMenu />);
    await ue.click(screen.getByRole('button', { name: tr('fr', 'shell.language') }));
    await ue.click(screen.getByRole('menuitemradio', { name: 'Français' }));
    expect(router.replace).not.toHaveBeenCalled();
  });
});
