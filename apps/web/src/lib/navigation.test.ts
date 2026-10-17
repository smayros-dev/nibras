import type { MyWorkspace } from '@tt/contracts';
import { currentNavId, matchesNavPath, navMatches, type NavSection } from '@tt/ui';
import { describe, expect, it } from 'vitest';
import { buildNavModel, workspaceIdFromPath, type NavModelInput } from './navigation';

const t = (key: string) => key;
const w1 = {
  workspace: { id: 'w1', name: 'Espace de Mohamed', slug: 'm', type: 'PERSONAL', status: 'ACTIVE' },
  role: 'OWNER',
} as MyWorkspace;

/** Every route `buildNavModel` may link to (locale-less), mirroring `src/app/[locale]`. */
const EXISTING_ROUTES = [
  /^\/app$/,
  /^\/app\/settings\/(profile|security|verification|consents|workspaces)$/,
  /^\/app\/w\/[^/]+$/,
  /^\/app\/w\/[^/]+\/(members|audit-log)$/,
  /^\/admin\/(workspaces|abuse-reports|health)$/,
];

function model(overrides: Partial<NavModelInput> = {}) {
  return buildNavModel({
    t,
    user: { platformRole: 'NONE' },
    workspaces: [w1],
    locale: 'fr',
    ...overrides,
  });
}

/** The sections the shell renders at `pathname` (locale-less here, `fr` prefixed). */
function visibleAt(sections: NavSection[], pathname: string, locale = 'fr') {
  return sections.filter(
    (s) => !s.visibleUnder || matchesNavPath(`/${locale}${pathname}`, s.visibleUnder),
  );
}

/** The item the shell marks current at `pathname`, as `AppShell` derives it. */
function currentAt(sections: NavSection[], pathname: string, locale = 'fr') {
  return currentNavId(navMatches(visibleAt(sections, pathname, locale)), `/${locale}${pathname}`);
}

describe('buildNavModel', () => {
  it('links only existing routes, the workspace section shown only inside it', () => {
    const sections = model();
    expect(sections.map((s) => s.id)).toEqual(['main', 'workspace-w1']);
    expect(sections[1]!.label).toBe('Espace de Mohamed');
    expect(sections[1]!.visibleUnder).toBe('/fr/app/w/w1');
    expect(visibleAt(sections, '/app').map((s) => s.id)).toEqual(['main']);
    expect(visibleAt(sections, '/app/w/w1/members').map((s) => s.id)).toEqual([
      'main',
      'workspace-w1',
    ]);
    expect(visibleAt(sections, '/app/w/w12').map((s) => s.id)).toEqual(['main']);
    expect(currentAt(sections, '/app/w/w1/members')).toBe('workspace-w1-members');
    for (const item of sections.flatMap((s) => s.items)) {
      expect(item.href.startsWith('/fr/')).toBe(true);
      const path = item.href.slice('/fr'.length);
      expect(
        EXISTING_ROUTES.some((route) => route.test(path)),
        path,
      ).toBe(true);
    }
  });

  it('has no workspace section without workspaces', () => {
    expect(model({ workspaces: [] }).map((s) => s.id)).toEqual(['main']);
  });

  it('adds the admin section for SUPER_ADMIN only, last', () => {
    const admin = model({ user: { platformRole: 'SUPER_ADMIN' } });
    expect(admin.map((s) => s.id)).toEqual(['main', 'workspace-w1', 'admin']);
    expect(currentAt(admin, '/admin/abuse-reports/r1')).toBe('admin-reports');
    expect(admin[2]!.items.map((i) => i.href)).toEqual([
      '/fr/admin/workspaces',
      '/fr/admin/abuse-reports',
      '/fr/admin/health',
    ]);
    expect(model().some((s) => s.id === 'admin')).toBe(false);
  });

  it.each([
    ['/app', 'dashboard'],
    ['/app/settings/profile', 'settings'],
    ['/app/settings/security?tab=1', 'settings'],
    ['/app/settings/workspaces', 'workspaces'],
    ['/app/w/w1', 'workspace-w1-settings'],
    ['/app/w/w1/audit-log', 'workspace-w1-audit'],
  ])('marks %s as %s only', (pathname, id) => {
    expect(currentAt(model(), pathname)).toBe(id);
  });

  it('prefixes hrefs and matches with the locale', () => {
    const sections = model({ locale: 'ar' });
    expect(sections[1]!.items[0]!.href).toBe('/ar/app/w/w1');
    expect(sections[0]!.items.find((i) => i.id === 'settings')!.match).toBe('/ar/app/settings');
    expect(currentAt(sections, '/app/w/w1', 'ar')).toBe('workspace-w1-settings');
  });
});

describe('workspaceIdFromPath', () => {
  it.each([
    ['/app/w/w1', 'w1'],
    ['/app/w/w1/members?x=1', 'w1'],
    ['/app', null],
    ['/app/settings/workspaces', null],
  ])('%s -> %s', (path, wid) => {
    expect(workspaceIdFromPath(path)).toBe(wid);
  });
});
