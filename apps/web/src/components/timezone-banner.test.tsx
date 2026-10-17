import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { TimezoneBanner } from './timezone-banner';

vi.mock('../lib/api', () => ({ api: { PATCH: vi.fn() }, asApiResult: (r: unknown) => r }));

function browserTimeZone(timeZone: string) {
  const real = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...args: []) => {
    const format = new real(...args);
    const resolved = format.resolvedOptions();
    return Object.assign(format, { resolvedOptions: () => ({ ...resolved, timeZone }) });
  }) as unknown as typeof Intl.DateTimeFormat);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('TimezoneBanner', () => {
  it('is hidden when the browser and the profile agree', () => {
    browserTimeZone('Africa/Tunis');
    renderWithIntl(<TimezoneBanner timezone="Africa/Tunis" />);
    expect(screen.queryByRole('button', { name: tr('fr', 'settings.timezone.accept') })).toBeNull();
  });

  it('appears out of the page flow, so showing it after hydration shifts nothing (no CLS)', async () => {
    browserTimeZone('Europe/Paris');
    renderWithIntl(<TimezoneBanner timezone="Africa/Tunis" />);
    const accept = await screen.findByRole('button', {
      name: tr('fr', 'settings.timezone.accept'),
    });
    // It is mounted client-side only (the server cannot know the browser zone): in the flow it
    // would push the page down under the user's pointer.
    const banner = accept.closest('[data-timezone-banner]');
    expect(banner).not.toBeNull();
    expect(banner!.className).toMatch(/(^|\s)fixed(\s|$)/);
    // Its in-flow spacer (rendered at the end of the page) lets the page scroll clear of it.
    const spacer = document.querySelector('[data-timezone-banner-spacer]');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
  });
});
