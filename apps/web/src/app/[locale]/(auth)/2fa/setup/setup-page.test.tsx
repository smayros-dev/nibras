import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../../../../test/render';
import TwoFactorSetupPage from './page';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../../../../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,') } }));

beforeEach(() => api.POST.mockReset());

async function submitPassword(password: string) {
  const ue = userEvent.setup();
  await ue.type(screen.getByLabelText(tr('fr', 'auth.setup.password')), password);
  await ue.click(screen.getByRole('button', { name: tr('fr', 'auth.setup.passwordContinue') }));
}

describe('2FA setup page: password step-up', () => {
  it('asks for the current password before requesting a seed', async () => {
    renderWithIntl(<TwoFactorSetupPage />);
    expect(screen.getByLabelText(tr('fr', 'auth.setup.password'))).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.queryByTestId('totp-secret')).toBeNull();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('a wrong password is a focused field error, no QR', async () => {
    api.POST.mockResolvedValue({ error: { code: 'INVALID_CREDENTIALS' } });
    renderWithIntl(<TwoFactorSetupPage />);
    await submitPassword('pas le bon');
    const field = screen.getByLabelText(tr('fr', 'auth.setup.password'));
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(field).toHaveFocus();
    expect(screen.getByText(tr('fr', 'auth.setup.wrongPassword'))).toBeVisible();
    expect(screen.queryByTestId('totp-secret')).toBeNull();
  });

  it('too many attempts is a focused form-level alert', async () => {
    api.POST.mockResolvedValue({ error: { code: 'RATE_LIMITED' } });
    renderWithIntl(<TwoFactorSetupPage />);
    await submitPassword('pas le bon');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(tr('fr', 'errors.RATE_LIMITED'));
    expect(alert).toHaveFocus();
  });

  it('the right password sends it and shows the seed to scan', async () => {
    api.POST.mockResolvedValue({
      data: { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/Nibras:a?secret=x' },
    });
    renderWithIntl(<TwoFactorSetupPage />);
    await submitPassword('le bon mot de passe');
    expect(await screen.findByTestId('totp-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expect(api.POST).toHaveBeenCalledWith('/auth/2fa/setup', {
      body: { password: 'le bon mot de passe' },
    });
    expect(screen.getByLabelText(tr('fr', 'auth.setup.code'))).toBeVisible();
  });
});
