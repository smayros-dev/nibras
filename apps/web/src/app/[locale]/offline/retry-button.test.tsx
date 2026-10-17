import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../../test/render';
import { RetryButton } from './retry-button';

describe('offline page retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reloads the current URL (the page the user was navigating to)', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderWithIntl(<RetryButton />, { locale: 'ar' });
    await userEvent.setup().click(screen.getByRole('button', { name: tr('ar', 'pwa.retry') }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
