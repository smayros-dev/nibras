import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { LogoutButton, UserMenu } from './user-menu';

const user = { id: 'u1', firstName: 'Mohamed', lastName: 'Ben Ali', email: 'mb@example.com' };

describe('UserMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens from the avatar with the name and email, profile and security links', async () => {
    const ue = userEvent.setup();
    const router = mockRouter({ pathname: '/app' });
    renderWithIntl(<UserMenu user={user} />);
    const trigger = screen.getByRole('button', {
      name: tr('fr', 'shell.userMenu').replace('{name}', 'Mohamed Ben Ali'),
    });
    trigger.focus();
    await ue.keyboard('{Enter}');
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Mohamed Ben Ali');
    expect(menu).toHaveTextContent('mb@example.com');
    await ue.click(screen.getByRole('menuitem', { name: tr('fr', 'shell.security') }));
    expect(router.push).toHaveBeenCalledWith('/app/settings/security');
  });

  it('logs out: POST /auth/logout, then login and refresh', async () => {
    const ue = userEvent.setup();
    const router = mockRouter({ pathname: '/app' });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithIntl(<UserMenu user={user} />);
    await ue.click(screen.getByRole('button', { name: /Mohamed Ben Ali/ }));
    await ue.click(screen.getByRole('menuitem', { name: tr('fr', 'shell.logout') }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows an error toast and stays put when logout fails', async () => {
    const ue = userEvent.setup();
    const router = mockRouter({ pathname: '/app' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    renderWithIntl(<UserMenu user={user} />, { locale: 'ar' });
    await ue.click(
      screen.getByRole('button', {
        name: tr('ar', 'shell.userMenu').replace('{name}', 'Mohamed Ben Ali'),
      }),
    );
    await ue.click(screen.getByRole('menuitem', { name: tr('ar', 'shell.logout') }));
    expect(await screen.findByText(tr('ar', 'shell.logoutFailed'))).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('LogoutButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows an error toast on a network error', async () => {
    const ue = userEvent.setup();
    const router = mockRouter();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderWithIntl(<LogoutButton />);
    await ue.click(screen.getByRole('button', { name: tr('fr', 'shell.logout') }));
    expect(await screen.findByText(tr('fr', 'shell.logoutFailed'))).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
