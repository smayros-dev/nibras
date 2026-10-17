'use client';

import type { AuditEntry, AuditLogPage } from '@tt/contracts';
import { MEMBERSHIP_ROLES } from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, SkeletonTable, Table } from '@tt/ui';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';
import { useAbortableQuery } from '../lib/paged-fetch';

/** Longer JSON payloads fold into a `<details>` (the summary shows the start). */
const INLINE_JSON_MAX = 80;

/** Before/after payload: JSON reads left-to-right even in `ar`. */
function JsonCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span aria-hidden="true">—</span>;
  const json = JSON.stringify(value);
  if (json.length <= INLINE_JSON_MAX) {
    return (
      <code dir="ltr" className="font-mono text-xs break-all text-fg">
        {json}
      </code>
    );
  }
  return (
    <details className="max-w-md">
      <summary className="cursor-pointer">
        <code dir="ltr" className="font-mono text-xs text-fg-muted">
          {`${json.slice(0, INLINE_JSON_MAX - 20)}…`}
        </code>
      </summary>
      <pre dir="ltr" className="mt-2 overflow-auto rounded-sm bg-bg-subtle p-2 text-xs">
        <code className="font-mono text-fg">{JSON.stringify(value, null, 2)}</code>
      </pre>
    </details>
  );
}

interface LoadedPage extends AuditLogPage {
  /** The cursor this page was requested with (`undefined` = first page). */
  cursor: string | undefined;
}

/**
 * Workspace audit log (PRD §9.2/§13.4): newest first, filters (action, from, to) debounced and
 * abortable, two-way cursor pagination (a stack of the cursors that led to the current page:
 * *Précédent* pops, *Suivant* pushes `nextCursor`), dates in the viewer's own time zone.
 */
export function AuditLogPanel({ wid }: { wid: string }) {
  const t = useTranslations();
  const locale = useLocale();

  // Membership roles get their translated label; platform roles (USER, SYSTEM, SUPER_ADMIN…)
  // stay verbatim.
  const roleLabel = (role: string): string =>
    (MEMBERSHIP_ROLES as readonly string[]).includes(role) ? t(`members.role_${role}`) : role;

  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  /** Cursors of the pages after the first; the last one is the current page. */
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const actionFilter = action.trim();

  // A filter change starts over from the first page.
  const filterSetter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setCursors([]);
  };

  const page = useAbortableQuery(
    [wid, actionFilter, from, to, cursor],
    async (signal): Promise<LoadedPage> => {
      let result;
      try {
        result = asApiResult<AuditLogPage>(
          await api.GET('/workspaces/{wid}/audit-log', {
            params: {
              path: { wid },
              query: {
                ...(actionFilter ? { action: actionFilter } : {}),
                ...(from ? { from: new Date(from).toISOString() } : {}),
                ...(to ? { to: new Date(to).toISOString() } : {}),
                ...(cursor ? { cursor } : {}),
                limit: 50,
              },
            },
            signal,
          }),
        );
      } catch {
        throw new Error(t('errors.INTERNAL_ERROR'));
      }
      if (result.error) throw new Error(apiErrorMessage(t, result.error));
      return {
        items: result.data?.items ?? [],
        nextCursor: result.data?.nextCursor ?? null,
        cursor,
      };
    },
  );

  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const columns = {
    action: t('workspace.auditAction'),
    actor: t('workspace.auditActor'),
    before: t('workspace.auditBefore'),
    after: t('workspace.auditAfter'),
    date: t('workspace.auditDate'),
  };

  const data = page.data;
  // *Suivant* only from the settled current page (no double push while the next one loads).
  const nextCursor =
    data && !page.loading && data.cursor === cursor ? (data.nextCursor ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-fg">{t('workspace.navAudit')}</h2>

      <div
        role="group"
        aria-label={t('workspace.auditFilters')}
        className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <Field htmlFor="audit-action" label={t('workspace.auditAction')}>
          <Input
            id="audit-action"
            type="search"
            dir="ltr"
            value={action}
            onChange={(e) => filterSetter(setAction)(e.target.value)}
          />
        </Field>
        <Field htmlFor="audit-from" label={t('workspace.auditFrom')}>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => filterSetter(setFrom)(e.target.value)}
          />
        </Field>
        <Field htmlFor="audit-to" label={t('workspace.auditTo')}>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => filterSetter(setTo)(e.target.value)}
          />
        </Field>
      </div>

      {page.error ? <Alert variant="danger">{page.error}</Alert> : null}

      <Card padding="none" aria-busy={page.loading}>
        {data === undefined ? (
          page.error ? null : (
            <SkeletonTable className="p-4" cols={5} />
          )
        ) : data.items.length === 0 ? (
          <EmptyState as="h3" icon={<ScrollText />} title={t('workspace.auditEmpty')} />
        ) : (
          <Table caption={t('workspace.navAudit')} hideCaption>
            <Table.Head>
              <Table.Row>
                <Table.Th>{columns.action}</Table.Th>
                <Table.Th>{columns.actor}</Table.Th>
                <Table.Th>{columns.before}</Table.Th>
                <Table.Th>{columns.after}</Table.Th>
                <Table.Th>{columns.date}</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {data.items.map((entry: AuditEntry) => (
                <Table.Row key={entry.id} data-testid={`audit-${entry.action}`}>
                  <Table.Td label={columns.action}>
                    <Badge variant="neutral" dir="ltr" className="font-mono">
                      {entry.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td label={columns.actor}>{roleLabel(entry.actorRole)}</Table.Td>
                  <Table.Td label={columns.before}>
                    <JsonCell value={entry.before} />
                  </Table.Td>
                  <Table.Td label={columns.after}>
                    <JsonCell value={entry.after} />
                  </Table.Td>
                  <Table.Td label={columns.date}>
                    {formatDate(new Date(entry.createdAt), locale, viewerTimezone)}
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Card>

      <nav
        aria-label={t('workspace.auditPagination')}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <Button
          variant="secondary"
          disabled={cursors.length === 0}
          onClick={() => setCursors((stack) => stack.slice(0, -1))}
        >
          <ChevronLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          {t('workspace.auditPrevious')}
        </Button>
        <Button
          variant="secondary"
          disabled={nextCursor === null}
          onClick={() => {
            if (nextCursor) setCursors((stack) => [...stack, nextCursor]);
          }}
        >
          {t('workspace.auditNext')}
          <ChevronRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        </Button>
      </nav>
    </div>
  );
}
