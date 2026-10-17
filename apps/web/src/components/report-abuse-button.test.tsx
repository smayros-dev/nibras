import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { ReportAbuseButton } from './report-abuse-button';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const counter = (count: number) =>
  tr('fr', 'abuse.descriptionCounter').replace('{count}', String(count)).replace('{min}', '10');

describe('ReportAbuseButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens from its trigger, counts characters, reports, confirms in place and by toast', async () => {
    api.POST.mockResolvedValue({ data: { id: 'r1', status: 'OPEN' }, error: undefined });
    const ue = userEvent.setup();
    renderWithIntl(<ReportAbuseButton workspaceId="w1" entityType="USER" entityId="u1" />);
    const trigger = screen.getByRole('button', { name: tr('fr', 'abuse.report') });
    await ue.click(trigger);

    const dialog = screen.getByRole('dialog', { name: tr('fr', 'abuse.title') });
    const description = within(dialog).getByLabelText(tr('fr', 'abuse.description'));
    expect(description).toHaveAccessibleDescription(counter(0));
    const submit = within(dialog).getByRole('button', { name: tr('fr', 'abuse.submit') });
    expect(submit).toBeDisabled();
    await ue.type(description, 'Insultes répétées');
    expect(description).toHaveAccessibleDescription(counter(17));
    await ue.click(submit);

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/abuse-reports', {
        params: { path: { wid: 'w1' } },
        body: {
          category: 'HARASSMENT',
          description: 'Insultes répétées',
          entityType: 'USER',
          entityId: 'u1',
        },
      }),
    );
    expect(await within(dialog).findByRole('status')).toHaveTextContent(tr('fr', 'abuse.sent'));
    expect(
      within(screen.getByRole('region', { hidden: true })).getByText(tr('fr', 'abuse.sent')),
    ).toBeInTheDocument();

    // The footer button (the icon close button comes last in DOM order).
    await ue.click(within(dialog).getAllByRole('button', { name: tr('fr', 'common.close') })[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('puts a validation issue on its field and keeps the dialog open', async () => {
    api.POST.mockResolvedValue({
      data: undefined,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'invalid',
        details: {
          issues: [{ code: 'too_small', path: ['description'], minimum: 10, origin: 'string' }],
        },
      },
    });
    const ue = userEvent.setup();
    renderWithIntl(
      <ReportAbuseButton
        workspaceId={null}
        entityType="USER"
        entityId="u1"
        open
        onOpenChange={() => {}}
      />,
    );
    const description = screen.getByLabelText(tr('fr', 'abuse.description'));
    await ue.type(description, '0123456789');
    await ue.click(screen.getByRole('button', { name: tr('fr', 'abuse.submit') }));
    await waitFor(() => expect(description).toHaveAttribute('aria-invalid', 'true'));
    expect(description).toHaveFocus();
    expect(api.POST).toHaveBeenCalledWith('/abuse-reports', expect.anything());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
