import type { MyWorkspace } from '@tt/contracts';
import { getTranslations } from 'next-intl/server';

export interface OnboardingChecklistProps {
  emailVerified: boolean;
  /** First/last name set AND phone verified (avatar/subject arrive with SP3). */
  profileComplete: boolean;
  workspaces: MyWorkspace[];
}

/**
 * PRD §8.1.3: *Votre espace est prêt à {done}/5* on the dashboard while incomplete. Hidden for
 * users with no PERSONAL workspace and no teaching membership. The last three items link to
 * routes later plans create; they render disabled (*Bientôt*) until then.
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

  return (
    <section
      data-testid="onboarding-checklist"
      className="mt-6 rounded-lg bg-white p-4 shadow-md"
      aria-labelledby="onboarding-title"
    >
      <h2 id="onboarding-title" className="mb-3 text-lg font-bold">
        {t('onboarding.title', { done, total: items.length })}
      </h2>
      <ul className="flex flex-col gap-2 text-sm">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            {item.done ? (
              <span aria-hidden="true">✓</span>
            ) : item.live ? (
              <span aria-hidden="true">○</span>
            ) : (
              <span aria-hidden="true">·</span>
            )}
            {item.done ? (
              <span>{t(`onboarding.${item.key}`)}</span>
            ) : item.live ? (
              <a href={item.href} className="text-brand-700 hover:underline">
                {t(`onboarding.${item.key}`)}
              </a>
            ) : (
              <span>
                {t(`onboarding.${item.key}`)} — {t('onboarding.soon')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
