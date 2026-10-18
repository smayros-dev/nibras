import type { AdminHealth } from '@nibras/contracts';
import { Alert, Badge, Card, Table } from '@nibras/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../lib/api';

/** Super-admin health probes (US-X02): database, Redis and every queue, server-rendered. */
export default async function AdminHealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  let health: AdminHealth | null = null;
  try {
    const result = asApiResult<AdminHealth>(await (await serverApi()).GET('/admin/health'));
    health = result.data ?? null;
  } catch {
    health = null;
  }

  const t = await getTranslations();

  if (!health) {
    return (
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold text-fg">{t('admin.navHealth')}</h2>
        <Alert variant="danger">{t('errors.INTERNAL_ERROR')}</Alert>
      </div>
    );
  }

  const probes = [
    { key: 'db', label: t('admin.health.db'), value: health.db },
    { key: 'redis', label: t('admin.health.redis'), value: health.redis },
  ] as const;
  const count = (value: number | null) => (value === null ? '—' : value);
  const columns = {
    name: t('admin.health.queue'),
    waiting: t('admin.health.waiting'),
    active: t('admin.health.active'),
    delayed: t('admin.health.delayed'),
    failed: t('admin.health.failed'),
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-fg">{t('admin.navHealth')}</h2>

      <section aria-labelledby="health-services" className="flex flex-col gap-3">
        <h3 id="health-services" className="text-lg font-semibold text-fg">
          {t('admin.health.services')}
        </h3>
        <ul className="grid gap-4 sm:grid-cols-2">
          {probes.map((probe) => (
            <li key={probe.key}>
              <Card className="flex-row items-center justify-between">
                <span className="font-medium">{probe.label}</span>
                <Badge
                  variant={probe.value === 'up' ? 'success' : 'danger'}
                  data-testid={`admin-health-${probe.key}`}
                >
                  {probe.value === 'up' ? t('admin.health.up') : t('admin.health.down')}
                </Badge>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Card padding="none">
        <Table caption={t('admin.health.queues')}>
          <Table.Head>
            <Table.Row>
              <Table.Th>{columns.name}</Table.Th>
              <Table.Th>{columns.waiting}</Table.Th>
              <Table.Th>{columns.active}</Table.Th>
              <Table.Th>{columns.delayed}</Table.Th>
              <Table.Th>{columns.failed}</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {health.queues.map((queue) => (
              <Table.Row key={queue.name}>
                <Table.Td label={columns.name}>
                  <span dir="ltr" className="font-mono">
                    {queue.name}
                  </span>
                </Table.Td>
                <Table.Td label={columns.waiting} numeric>
                  {count(queue.waiting)}
                </Table.Td>
                <Table.Td label={columns.active} numeric>
                  {count(queue.active)}
                </Table.Td>
                <Table.Td label={columns.delayed} numeric>
                  {count(queue.delayed)}
                </Table.Td>
                <Table.Td label={columns.failed} numeric>
                  {queue.failed ? (
                    <Badge variant="danger">{queue.failed}</Badge>
                  ) : (
                    count(queue.failed)
                  )}
                </Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Card>
    </div>
  );
}
