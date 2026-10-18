import { screen } from '@testing-library/react';
import {
  defaultWorkspaceSettings,
  type MemberSummary,
  type MembershipRole,
  type WorkspaceDetail,
} from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { WorkspaceSettingsPanel } from './workspace-settings-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const ADMIN: MemberSummary = {
  userId: 'aaaaaaaa-0000-4000-8000-000000000002',
  firstName: 'Karim',
  lastName: 'Test',
  email: 'karim@example.com',
  role: 'ADMIN',
  canTeach: false,
  status: 'ACTIVE',
  joinedAt: '2026-10-01T08:00:00.000Z',
};

function detail(myRole: MembershipRole, status: WorkspaceDetail['status']): WorkspaceDetail {
  return {
    id: 'w1',
    name: 'École Atlas',
    slug: 'ecole-atlas',
    type: 'ORGANIZATION',
    status,
    country: 'TN',
    defaultTimezone: 'Africa/Tunis',
    defaultLocale: 'fr',
    allowPersonalWorkspaces: true,
    createdAt: '2026-10-01T08:00:00.000Z',
    myRole,
    myCanTeach: false,
  };
}

function renderPanel(myRole: MembershipRole, status: WorkspaceDetail['status']) {
  return renderWithIntl(
    <WorkspaceSettingsPanel
      wid="w1"
      detail={detail(myRole, status)}
      settings={defaultWorkspaceSettings('Africa/Tunis')}
      storage={null}
      admins={[ADMIN]}
    />,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('WorkspaceSettingsPanel', () => {
  it('offers save, transfer and delete to the OWNER of an ACTIVE workspace', () => {
    renderPanel('OWNER', 'ACTIVE');
    expect(screen.getByRole('button', { name: tr('fr', 'workspace.save') })).toBeInTheDocument();
    expect(screen.getByLabelText(tr('fr', 'workspace.transferTo'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('fr', 'workspace.delete') })).toBeInTheDocument();
  });

  it.each(['SUSPENDED', 'DELETING'] as const)(
    'hides every write action of a %s workspace, even for its OWNER',
    (status) => {
      renderPanel('OWNER', status);
      // The fields stay readable, disabled.
      expect(screen.getByDisplayValue('École Atlas')).toBeDisabled();
      expect(
        screen.queryByRole('button', { name: tr('fr', 'workspace.save') }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText(tr('fr', 'workspace.transferTo'))).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: tr('fr', 'workspace.delete') }),
      ).not.toBeInTheDocument();
    },
  );

  it('keeps the form read-only for a TEACHER', () => {
    renderPanel('TEACHER', 'ACTIVE');
    expect(screen.getByText(tr('fr', 'workspace.readOnly'))).toBeInTheDocument();
    expect(screen.getByDisplayValue('École Atlas')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: tr('fr', 'workspace.delete') }),
    ).not.toBeInTheDocument();
  });
});
