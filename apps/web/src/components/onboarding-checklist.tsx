import type { MyWorkspace } from '@nibras/contracts';
import { Badge, Card } from '@nibras/ui';
import { CircleCheck, Circle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '../i18n/navigation';

export interface OnboardingChecklistProps {
  emailVerified: boolean;
  /** First/last name set AND phone verified (avatar/subject arrive with SP3). */
  profileComplete: boolean;
  workspaces: MyWorkspace[];
}

/**
 * PRD §8.1.3: *Votre espace est prêt à {done}/5* on the dashboard while incomplete, with a
 * progress bar. Hidden for users with no PERSONAL workspace and no teaching membership. The last
 * three items link to routes later plans create; they render as text with a *Bientôt* badge.
 */
export async function OnboardingChecklist({
  emailVerified,
  profileComplete,
  workspaces,
}: OnboardingChecklistProps) {
  const t = await getTranslations();

  const eligible = workspaces.some(
    (m) => m.workspace.type === 'PERSONAL' || ['OWNER', 'ADMIN', 'TEACHER'].includes(m.role),
  );
  if (!eligible) return null;

  const items = [
    { key: 'profile', done: profileComplete, href: '/app/settings/profile', live: true },
    { key: 'verifyEmail', done: emailVerified, href: '/app/settings/verification', live: true },
    { key: 'firstCourse', done: false, href: '/app/courses/new', live: false },
    { key: 'inviteStudents', done: false, href: '/app/students', live: false },
    { key: 'firstSession', done: false, href: '/app/sessions/new', live: false },
  ] as const;
  const done = items.filter((item) => item.done).length;
  if (done === items.length) return null;
  const title = t('onboarding.title', { done, total: items.length });

  return (
    <Card data-testid="onboarding-checklist">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={done}
          className="flex w-full gap-1"
        >
          {/* One segment per item: no inline `style` (the CSP forbids style attributes). */}
          {items.map((item, index) => (
            <div
              key={item.key}
              className={
                index < done
                  ? 'h-2 flex-1 rounded-full bg-primary'
                  : 'h-2 flex-1 rounded-full bg-bg-subtle'
              }
            />
          ))}
        </div>
      </Card.Header>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <li key={item.key} className="flex min-h-11 items-center gap-3">
            {item.done ? (
              <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-success" />
            ) : (
              <Circle aria-hidden="true" className="size-5 shrink-0 text-fg-subtle" />
            )}
            {item.done ? (
              <span className="text-fg-muted line-through">{t(`onboarding.${item.key}`)}</span>
            ) : item.live ? (
              <Link href={item.href} className="text-primary hover:underline">
                {t(`onboarding.${item.key}`)}
              </Link>
            ) : (
              <span className="flex flex-wrap items-center gap-2 text-fg-muted">
                {t(`onboarding.${item.key}`)}
                <Badge variant="neutral">{t('onboarding.soon')}</Badge>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
