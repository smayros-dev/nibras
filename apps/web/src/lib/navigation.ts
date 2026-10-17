import type { MeUser, MyWorkspace } from '@tt/contracts';
import type { NavItem, NavSection } from '@tt/ui';
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
  /** Locale-less current path (`/app/w/w1/members`); a query or hash is ignored. */
  pathname: string;
  workspaces: MyWorkspace[];
  /** The workspace in the URL (`/app/w/{wid}`), if any. */
  currentWid: string | null;
  /** Prefixes every `href` (`/fr/app`): the shell renders plain links. */
  locale: string;
}

type ItemSpec = Omit<NavItem, 'current'>;

/** `current` from the locale-less path: exact match, or the item's path and below. */
function isCurrent(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The `{wid}` of a `/app/w/{wid}/...` path. */
export function workspaceIdFromPath(pathname: string): string | null {
  return /^\/app\/w\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * The shell navigation (spec §5, PRD §9.1) built from the routes that exist today and the user's
 * role. Pure: `href`s are locale-prefixed, `current` is computed from the locale-less `pathname`.
 *
 * PRD §9.1 order; future items are added by their owning sub-project and not rendered before:
 * Dashboard · Cours (SP3) · Étudiants (SP4) · Sessions (SP5) · Messages (SP8) · Notifications (SP9)
 * · Espaces · Paramètres.
 */
export function buildNavModel({
  t,
  user,
  pathname: rawPathname,
  workspaces,
  currentWid,
  locale,
}: NavModelInput): NavSection[] {
  const pathname = rawPathname.replace(/[?#].*$/, '') || '/';
  const make = (
    spec: ItemSpec,
    current = isCurrent(pathname, spec.href, spec.exact === true),
  ): NavItem => ({ ...spec, href: `/${locale}${spec.href}`, current });

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
        make(
          {
            id: 'settings',
            href: '/app/settings/profile',
            label: t('nav.settings'),
            icon: Settings,
          },
          isCurrent(pathname, '/app/settings') && !isCurrent(pathname, '/app/settings/workspaces'),
        ),
      ],
    },
  ];

  const current = currentWid
    ? workspaces.find((membership) => membership.workspace.id === currentWid)
    : undefined;
  if (current) {
    const base = `/app/w/${current.workspace.id}`;
    sections.push({
      id: 'workspace',
      label: current.workspace.name,
      items: [
        make({
          id: 'workspace-settings',
          href: base,
          label: t('workspace.navSettings'),
          icon: SlidersHorizontal,
          exact: true,
        }),
        make({
          id: 'workspace-members',
          href: `${base}/members`,
          label: t('workspace.navMembers'),
          icon: Users,
        }),
        make({
          id: 'workspace-audit',
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
