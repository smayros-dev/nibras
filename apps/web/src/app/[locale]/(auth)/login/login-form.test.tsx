import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../../../test/render';
import { LoginForm } from './login-form';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../../../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

beforeEach(() => api.POST.mockReset());

async function submit() {
  const ue = userEvent.setup();
  await ue.type(screen.getByLabelText(tr('fr', 'auth.login.email')), 'a@example.com');
  await ue.type(screen.getByLabelText(tr('fr', 'auth.login.password')), 'secret-password');
  await ue.click(screen.getByRole('button', { name: tr('fr', 'auth.login.submit') }));
}

describe('LoginForm', () => {
  it('moves focus to the first invalid field after a rejected submit', async () => {
    api.POST.mockResolvedValue({
      error: {
        code: 'VALIDATION_FAILED',
        details: { issues: [{ path: ['password'], code: 'invalid_type' }] },
      },
    });
    renderWithIntl(<LoginForm next={null} />);
    await submit();
    const password = screen.getByLabelText(tr('fr', 'auth.login.password'));
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'));
    expect(password).toHaveFocus();
  });

  it('moves focus to the error alert when the failure is form-level', async () => {
    api.POST.mockResolvedValue({ error: { code: 'INVALID_CREDENTIALS' } });
    renderWithIntl(<LoginForm next={null} />);
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('tabindex', '-1');
    expect(alert).toHaveFocus();
  });
});
