'use client';

import type { AuditEntry, AuditLogPage } from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import { Button, Field, TextInput } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';

/**
 * Workspace audit log (PRD §9.2/§13.4): newest first, filters (action, from, to), cursor
 * pagination via *Suivant*, dates rendered in the viewer's own time zone.
 */
export function AuditLogPanel({ wid }: { wid: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(
    async (next?: string) => {
      const { data, error: getError } = asApiResult<AuditLogPage>(
        await api.GET('/workspaces/{wid}/audit-log', {
          params: {
            path: { wid },
            query: {
              ...(action ? { action } : {}),
              ...(from ? { from: new Date(from).toISOString() } : {}),
              ...(to ? { to: new Date(to).toISOString() } : {}),
              ...(next ? { cursor: next } : {}),
              limit: 50,
            },
          },
        }),
      );
      if (getError) setError(apiErrorMessage(t, getError as unknown));
      else {
        setEntries(data?.items ?? []);
        setNextCursor(data?.nextCursor ?? null);
      }
    },
    [wid, action, from, to, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{t('workspace.navAudit')}</h1>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="audit-action" label="action">
          <TextInput id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} />
        </Field>
        <Field htmlFor="audit-from" label="from">
          <TextInput
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field htmlFor="audit-to" label="to">
          <TextInput id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <table className="w-full max-w-3xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="py-1 text-start">action</th>
            <th className="py-1 text-start">{t('members.role')}</th>
            <th className="py-1 text-start">before</th>
            <th className="py-1 text-start">after</th>
            <th className="py-1 text-start">{t('members.joined')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              data-testid={`audit-${entry.action}`}
              className="border-b border-gray-100"
            >
              <td className="py-1 font-mono">{entry.action}</td>
              <td className="py-1">{entry.actorRole}</td>
              <td className="py-1 font-mono text-xs">
                {entry.before ? JSON.stringify(entry.before) : '—'}
              </td>
              <td className="py-1 font-mono text-xs">
                {entry.after ? JSON.stringify(entry.after) : '—'}
              </td>
              <td className="py-1">
                {formatDate(new Date(entry.createdAt), locale, viewerTimezone)}
              </td>
            </tr>
          ))}
          {entries.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-2 text-gray-500">
                —
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {nextCursor ? (
        <Button variant="secondary" onClick={() => void load(nextCursor)}>
          Suivant
        </Button>
      ) : null}
    </div>
  );
}
