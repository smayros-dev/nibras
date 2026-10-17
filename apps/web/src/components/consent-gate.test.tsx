import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { ConsentGate } from './consent-gate';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const VERSIONS = {
  TERMS: 'terms-e2e-2026-11',
  PRIVACY: 'privacy-2026-10',
  CODE_OF_CONDUCT: 'coc-2026-10',
};

function renderGate(locale: 'fr' | 'ar' = 'fr') {
  return renderWithIntl(
    <ConsentGate pending={['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT']} versions={VERSIONS} />,
    { locale },
  );
}

describe('ConsentGate', () => {
  beforeEach(() => {
    api.POST.mockResolvedValue({ data: {}, error: undefined });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists each pending consent with its version and a link to the legal page', () => {
    renderGate();
    const dialog = screen.getByRole('dialog', { name: tr('fr', 'auth.consent.title') });
    expect(dialog).toBeInTheDocument();
    for (const version of Object.values(VERSIONS))
      expect(screen.getByText(version)).toBeInTheDocument();
    const links: [string, string][] = [
      ['auth.consent.readTerms', '/legal/terms'],
      ['auth.consent.readPrivacy', '/legal/privacy'],
      ['auth.consent.readCoc', '/legal/code-of-conduct'],
    ];
    for (const [key, href] of links) {
      // The sr-only cue tells screen-reader users the link leaves this tab.
      const link = screen.getByRole('link', {
        name: `${tr('fr', key)} ${tr('fr', 'common.newTab')}`,
      });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener');
    }
  });

  it('cannot be dismissed: no close button, Escape and outside clicks keep it open', async () => {
    renderGate();
    expect(screen.queryByRole('button', { name: tr('fr', 'common.close') })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('posts one grant per pending type at its version, then refreshes the layout', async () => {
    const router = mockRouter({ pathname: '/app' });
    renderGate();
    await userEvent.click(screen.getByRole('button', { name: tr('fr', 'auth.consent.accept') }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(api.POST).toHaveBeenCalledTimes(3);
    for (const [type, version] of Object.entries(VERSIONS))
      expect(api.POST).toHaveBeenCalledWith('/me/consents/{type}', {
        params: { path: { type } },
        body: { version },
      });
  });

  it('re-enables accept when consents are still pending after the refresh', async () => {
    // e.g. a version bump between render and accept, or a web/API version mismatch: the refreshed
    // layout renders the gate again and the button must not spin forever.
    const router = mockRouter({ pathname: '/app' });
    renderGate();
    const accept = screen.getByRole('button', { name: tr('fr', 'auth.consent.accept') });
    await userEvent.click(accept);
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(accept).toBeEnabled());
    expect(accept).not.toHaveAttribute('aria-busy', 'true');
  });

  it('shows the error and re-enables accept when a grant fails', async () => {
    const router = mockRouter({ pathname: '/app' });
    api.POST.mockResolvedValueOnce({ data: {}, error: undefined }).mockResolvedValueOnce({
      data: undefined,
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });
    renderGate();
    const accept = screen.getByRole('button', { name: tr('fr', 'auth.consent.accept') });
    await userEvent.click(accept);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(tr('fr', 'errors.INTERNAL_ERROR'));
    expect(api.POST).toHaveBeenCalledTimes(2);
    expect(router.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(accept).toBeEnabled());
    expect(accept).not.toHaveAttribute('aria-busy', 'true');
  });
});
