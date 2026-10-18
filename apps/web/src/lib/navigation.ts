import type { MeUser, MyWorkspace } from '@nibras/contracts';
import type { NavItem, NavSection } from '@nibras/ui';
import {
  Activity,
  Building2,
  Flag,
  LayoutDashboard,
  ScrollText,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

/** The translator the model needs (next-intl's `t` from `getTranslations()` / `useTranslations()`). */
export type NavTranslate = (key: string) => string;

export interface NavModelInput {
  t: NavTranslate;
  user: Pick<MeUser, 'platformRole'>;
  workspaces: MyWorkspace[];
  /** Prefixes every `href` and `match` (`/fr/app`), the form of the shell's live path. */
  locale: string;
}

type ItemSpec = Omit<NavItem, 'current'>;

/** The `{wid}` of a `/app/w/{wid}/...` path. */
export function workspaceIdFromPath(pathname: string): string | null {
  return /^\/app\/w\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * The shell navigation (spec §5, PRD §9.1) built from the routes that exist today and the user's
 * role. Pure and path-independent: the layout stays mounted across client navigations, so the
 * current item (longest `match`) and the workspace section shown (`visibleUnder`) are derived on
 * the client from the live path (`ShellPathProvider`). `href`s and matches are locale-prefixed.
 *
 * PRD §9.1 order; future items are added by their owning sub-project and not rendered before:
 * Dashboard · Cours (SP3) · Étudiants (SP4) · Sessions (SP5) · Messages (SP8) · Notifications (SP9)
 * · Espaces · Paramètres.
 */
export function buildNavModel({ t, user, workspaces, locale }: NavModelInput): NavSection[] {
  const make = (spec: ItemSpec): NavItem => ({
    ...spec,
    href: `/${locale}${spec.href}`,
    ...(spec.match ? { match: `/${locale}${spec.match}` } : {}),
  });

  const sections: NavSection[] = [
    {
      id: 'main',
      items: [
        make({
          id: 'dashboard',
          href: '/app',
          label: t('nav.dashboard'),
          icon: LayoutDashboard,
          exact: true,
        }),
        // Cours (SP3), Étudiants (SP4), Sessions (SP5), Messages (SP8), Notifications (SP9).
        make({
          id: 'workspaces',
          href: '/app/settings/workspaces',
          label: t('nav.workspaces'),
          icon: Building2,
        }),
        // Every settings page except Espaces (a longer, so winning, match).
        make({
          id: 'settings',
          href: '/app/settings/profile',
          match: '/app/settings',
          label: t('nav.settings'),
          icon: Settings,
        }),
      ],
    },
  ];

  // One section per workspace, shown only inside it (`/app/w/{wid}`).
  for (const { workspace } of workspaces) {
    const base = `/app/w/${workspace.id}`;
    sections.push({
      id: `workspace-${workspace.id}`,
      label: workspace.name,
      visibleUnder: `/${locale}${base}`,
      items: [
        make({
          id: `workspace-${workspace.id}-settings`,
          href: base,
          label: t('workspace.navSettings'),
          icon: SlidersHorizontal,
          exact: true,
        }),
        make({
          id: `workspace-${workspace.id}-members`,
          href: `${base}/members`,
          label: t('workspace.navMembers'),
          icon: Users,
        }),
        make({
          id: `workspace-${workspace.id}-audit`,
          href: `${base}/audit-log`,
          label: t('workspace.navAudit'),
          icon: ScrollText,
        }),
      ],
    });
  }

  if (user.platformRole === 'SUPER_ADMIN') {
    sections.push({
      id: 'admin',
      label: t('admin.title'),
      items: [
        make({
          id: 'admin-console',
          href: '/admin/workspaces',
          label: t('nav.console'),
          icon: Shield,
        }),
        make({
          id: 'admin-reports',
          href: '/admin/abuse-reports',
          label: t('admin.navAbuseReports'),
          icon: Flag,
        }),
        make({
          id: 'admin-health',
          href: '/admin/health',
          label: t('admin.navHealth'),
          icon: Activity,
        }),
      ],
    });
  }

  return sections;
}
