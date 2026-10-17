import type { MyWorkspace } from '@tt/contracts';
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
    pathname: '/app',
    workspaces: [w1],
    currentWid: null,
    locale: 'fr',
    ...overrides,
  });
}

function currentIds(sections: ReturnType<typeof model>) {
  return sections.flatMap((s) => s.items.filter((i) => i.current).map((i) => i.id));
}

describe('buildNavModel', () => {
  it('shows only existing routes and the workspace section when inside one', () => {
    const sections = model({ pathname: '/app/w/w1/members', currentWid: 'w1' });
    expect(sections.map((s) => s.id)).toEqual(['main', 'workspace']);
    expect(sections[1]!.label).toBe('Espace de Mohamed');
    expect(currentIds(sections)).toEqual(['workspace-members']);
    for (const item of sections.flatMap((s) => s.items)) {
      expect(item.href.startsWith('/fr/')).toBe(true);
      const path = item.href.slice('/fr'.length);
      expect(
        EXISTING_ROUTES.some((route) => route.test(path)),
        path,
      ).toBe(true);
    }
  });

  it('has no workspace section outside a workspace or for an unknown workspace id', () => {
    expect(model().map((s) => s.id)).toEqual(['main']);
    expect(model({ pathname: '/app/w/zz', currentWid: 'zz' }).map((s) => s.id)).toEqual(['main']);
  });

  it('adds the admin section for SUPER_ADMIN only', () => {
    const admin = model({
      user: { platformRole: 'SUPER_ADMIN' },
      pathname: '/admin/abuse-reports/r1',
    });
    expect(admin.map((s) => s.id)).toEqual(['main', 'admin']);
    expect(currentIds(admin)).toEqual(['admin-reports']);
    expect(admin[1]!.items.map((i) => i.href)).toEqual([
      '/fr/admin/workspaces',
      '/fr/admin/abuse-reports',
      '/fr/admin/health',
    ]);
    expect(model().some((s) => s.id === 'admin')).toBe(false);
    // Inside a workspace too, the admin section comes last.
    expect(
      model({
        user: { platformRole: 'SUPER_ADMIN' },
        pathname: '/app/w/w1',
        currentWid: 'w1',
      }).map((s) => s.id),
    ).toEqual(['main', 'workspace', 'admin']);
  });

  it.each([
    ['/app', 'dashboard'],
    ['/app/settings/profile', 'settings'],
    ['/app/settings/security?tab=1', 'settings'],
    ['/app/settings/workspaces', 'workspaces'],
  ])('marks %s as %s only', (pathname, id) => {
    expect(currentIds(model({ pathname }))).toEqual([id]);
  });

  it('matches the workspace settings item exactly and prefixes the locale', () => {
    const sections = model({ pathname: '/app/w/w1', currentWid: 'w1', locale: 'ar' });
    expect(currentIds(sections)).toEqual(['workspace-settings']);
    expect(sections[1]!.items[0]!.href).toBe('/ar/app/w/w1');
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
