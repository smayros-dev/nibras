import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditEntry } from '@tt/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { AuditLogPanel } from './audit-log-panel';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

function entry(id: string, action: string, extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    action,
    entityType: 'Workspace',
    entityId: 'w1',
    actorUserId: 'u1',
    actorRole: 'OWNER',
    before: null,
    after: null,
    ip: null,
    userAgent: null,
    requestId: `r-${id}`,
    createdAt: '2026-10-01T08:00:00.000Z',
    ...extra,
  };
}

const PAGE_1 = [
  entry('e1', 'member.role_changed', {
    before: { role: 'TEACHER', canTeach: true },
    after: { role: 'ADMIN', canTeach: true },
  }),
];
const PAGE_2 = [entry('e2', 'workspace.created')];

type Query = { cursor?: string; action?: string };

function queries(): Query[] {
  return api.GET.mock.calls.map(([, init]) => init.params.query as Query);
}

beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockImplementation(async (_path: string, init: { params: { query: Query } }) =>
    init.params.query.cursor === 'c2'
      ? { data: { items: PAGE_2, nextCursor: null } }
      : { data: { items: PAGE_1, nextCursor: 'c2' } },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AuditLogPanel', () => {
  it('labels the date column "Date" (not the members "joined" header)', async () => {
    renderWithIntl(<AuditLogPanel wid="w1" />);
    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toContain(tr('fr', 'workspace.auditDate'));
    expect(headers).not.toContain(tr('fr', 'members.joined'));
  });

  it('renders before/after JSON left-to-right, even in ar', async () => {
    renderWithIntl(<AuditLogPanel wid="w1" />, { locale: 'ar' });
    const row = await screen.findByTestId('audit-member.role_changed');
    const code = within(row).getByText('{"role":"TEACHER","canTeach":true}');
    expect(code.closest('[dir="ltr"]')).not.toBeNull();
  });

  it('Suivant then Précédent requests the first page (no cursor) again', async () => {
    const ue = userEvent.setup();
    renderWithIntl(<AuditLogPanel wid="w1" />);
    await screen.findByTestId('audit-member.role_changed');
    const previous = screen.getByRole('button', { name: tr('fr', 'workspace.auditPrevious') });
    expect(previous).toBeDisabled();

    await ue.click(screen.getByRole('button', { name: tr('fr', 'workspace.auditNext') }));
    expect(await screen.findByTestId('audit-workspace.created')).toBeInTheDocument();
    expect(queries().at(-1)?.cursor).toBe('c2');
    expect(screen.getByRole('button', { name: tr('fr', 'workspace.auditNext') })).toBeDisabled();

    await ue.click(screen.getByRole('button', { name: tr('fr', 'workspace.auditPrevious') }));
    expect(await screen.findByTestId('audit-member.role_changed')).toBeInTheDocument();
    expect(queries().at(-1)?.cursor).toBeUndefined();
    expect(queries()).toHaveLength(3);
  });

  it('debounces the action filter to one request', async () => {
    vi.useFakeTimers();
    renderWithIntl(<AuditLogPanel wid="w1" />);
    await act(async () => {});
    expect(api.GET).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText(tr('fr', 'workspace.auditAction'));
    for (const value of ['m', 'me', 'mem', 'member']) {
      fireEvent.change(input, { target: { value } });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(api.GET).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(api.GET).toHaveBeenCalledTimes(2);
    expect(queries().at(-1)?.action).toBe('member');
  });

  it('disables Suivant during the filter debounce (no cursor from another result set)', async () => {
    vi.useFakeTimers();
    renderWithIntl(<AuditLogPanel wid="w1" />);
    await act(async () => {});
    const next = screen.getByRole('button', { name: tr('fr', 'workspace.auditNext') });
    expect(next).toBeEnabled();

    fireEvent.change(screen.getByLabelText(tr('fr', 'workspace.auditAction')), {
      target: { value: 'member' },
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(api.GET).toHaveBeenCalledTimes(1);
    expect(next).toBeDisabled();
    fireEvent.click(next);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(queries().every((q) => q.cursor === undefined)).toBe(true);
    expect(queries().at(-1)?.action).toBe('member');
    expect(next).toBeEnabled();
  });

  it('shows an empty state when no entry matches', async () => {
    api.GET.mockResolvedValue({ data: { items: [], nextCursor: null } });
    renderWithIntl(<AuditLogPanel wid="w1" />);
    expect(await screen.findByText(tr('fr', 'workspace.auditEmpty'))).toBeInTheDocument();
  });
});
