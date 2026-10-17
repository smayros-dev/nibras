import { dirOf } from '@tt/contracts/web';
import type { Locale, MeUser, MyWorkspace } from '@tt/contracts';
import { AppShell } from '@tt/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { asApiResult, serverApi } from '../lib/api';
import { buildNavModel } from '../lib/navigation';
import { AuthRefresher } from './auth-refresher';
import { LocaleMenu } from './locale-menu';
import { ShellPathProvider } from './shell-path-provider';
import { ThemeToggleClient } from './theme-provider';
import { LogoutButton, UserMenu } from './user-menu';
import { WorkspaceSwitcher } from './workspace-switcher';

/**
 * The authenticated frame shared by the `(app)` and `(admin)` layouts: the nav model, the
 * workspace switcher, the locale menu, the theme toggle and the user menu (spec §5), and the
 * proactive session refresher. The layout stays mounted across client navigations, so nothing
 * here depends on the path: the current nav item and the workspace section shown are derived on
 * the client (`ShellPathProvider`).
 */
export async function AppFrame({
  locale,
  user,
  inert = false,
  children,
}: {
  locale: Locale;
  user: MeUser;
  /** The whole frame is inert while a blocking dialog (the consent gate) is open next to it. */
  inert?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations();
  const { data } = asApiResult<MyWorkspace[]>(await (await serverApi()).GET('/me/workspaces'));
  const workspaces = data ?? [];
  const sections = buildNavModel({
    t: (key) => t(key),
    user,
    workspaces,
    locale,
  });

  return (
    <ShellPathProvider>
      <AppShell
        locale={locale}
        dir={dirOf(locale)}
        inert={inert}
        brand={{ name: t('common.appName'), href: `/${locale}/app` }}
        sections={sections}
        labels={{
          skipToContent: t('nav.skipToContent'),
          primaryNav: t('nav.primaryNav'),
          secondaryNav: t('nav.secondaryNav'),
          more: t('nav.more'),
          closeMenu: t('nav.closeMenu'),
          brandHome: t('nav.brandHome'),
        }}
        topBarStart={<WorkspaceSwitcher workspaces={workspaces} />}
        topBarEnd={
          <>
            {/* Below `lg` the language and theme live in the "More" sheet. */}
            <div className="hidden items-center gap-1 lg:flex">
              <LocaleMenu />
              <ThemeToggleClient />
            </div>
            <UserMenu
              user={{
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
              }}
            />
          </>
        }
        moreSheetExtra={
          <>
            <div className="flex items-center gap-1">
              <LocaleMenu />
              <ThemeToggleClient />
            </div>
            <LogoutButton />
          </>
        }
      >
        <AuthRefresher />
        {children}
      </AppShell>
    </ShellPathProvider>
  );
}
