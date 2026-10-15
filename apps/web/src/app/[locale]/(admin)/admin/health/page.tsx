import type { AdminHealth } from '@tt/contracts';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../lib/api';

/** Super-admin health probes (US-X02): database, Redis and every queue, server-rendered. */
export default async function AdminHealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  let health: AdminHealth | null = null;
  try {
    const result = asApiResult<AdminHealth>(await (await serverApi()).GET('/admin/health'));
    health = result.data ?? null;
  } catch {
    health = null;
  }
  if (!health) notFound();

  const t = await getTranslations();
  const probe = (value: 'up' | 'down') =>
    value === 'up' ? t('admin.health.up') : t('admin.health.down');

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex gap-6 text-sm">
        <div>
          <dt className="font-semibold">{t('admin.health.db')}</dt>
          <dd data-testid="admin-health-db">{probe(health.db)}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('admin.health.redis')}</dt>
          <dd data-testid="admin-health-redis">{probe(health.redis)}</dd>
        </div>
      </dl>

      <table className="w-full max-w-2xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="py-1 text-start">{t('admin.health.name')}</th>
            <th className="py-1 text-start">{t('admin.health.waiting')}</th>
            <th className="py-1 text-start">{t('admin.health.active')}</th>
            <th className="py-1 text-start">{t('admin.health.delayed')}</th>
            <th className="py-1 text-start">{t('admin.health.failed')}</th>
          </tr>
        </thead>
        <tbody>
          {health.queues.map((queue) => (
            <tr key={queue.name} className="border-b border-gray-100">
              <td className="py-1 font-mono">{queue.name}</td>
              <td className="py-1">{queue.waiting ?? '—'}</td>
              <td className="py-1">{queue.active ?? '—'}</td>
              <td className="py-1">{queue.delayed ?? '—'}</td>
              <td className="py-1">{queue.failed ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
