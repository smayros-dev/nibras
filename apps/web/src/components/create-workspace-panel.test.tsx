import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { CreateWorkspacePanel } from './create-workspace-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('CreateWorkspacePanel', () => {
  it('renders the organisation name on a 403 PERSONAL_WORKSPACE_FORBIDDEN', async () => {
    const ue = userEvent.setup();
    api.POST.mockResolvedValue({
      error: {
        code: 'PERSONAL_WORKSPACE_FORBIDDEN',
        message: 'forbidden',
        details: { organizationName: 'École Atlas' },
      },
    });
    renderWithIntl(<CreateWorkspacePanel workspaces={[]} />);
    await ue.click(screen.getByRole('tab', { name: tr('fr', 'settings.workspaces.tabPersonal') }));
    await ue.click(screen.getByRole('button', { name: tr('fr', 'workspace.submitPersonal') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      tr('fr', 'workspace.personalForbidden').replace('{organizationName}', 'École Atlas'),
    );
    expect(api.POST).toHaveBeenCalledWith('/me/personal-workspace', {});
  });

  it('re-enables the submit button after a network error', async () => {
    const ue = userEvent.setup();
    api.POST.mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithIntl(<CreateWorkspacePanel workspaces={[]} />, { locale: 'ar' });
    await ue.type(screen.getByLabelText(tr('ar', 'workspace.name')), 'Atlas');
    const submit = screen.getByRole('button', { name: tr('ar', 'workspace.submitOrganization') });
    await ue.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(tr('ar', 'errors.INTERNAL_ERROR'));
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('toasts and refreshes the list once an organisation is created', async () => {
    const ue = userEvent.setup();
    const router = mockRouter();
    api.POST.mockResolvedValue({ data: { id: 'w1' } });
    renderWithIntl(<CreateWorkspacePanel workspaces={[]} />);
    await ue.type(screen.getByLabelText(tr('fr', 'workspace.name')), 'Atlas');
    await ue.click(screen.getByRole('button', { name: tr('fr', 'workspace.submitOrganization') }));
    expect(await screen.findByText(tr('fr', 'workspace.created'))).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });
});
