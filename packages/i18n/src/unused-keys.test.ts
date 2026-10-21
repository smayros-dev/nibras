import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { flattenKeys, messages } from './locales';

/**
 * Unused-key guard: every catalogue key must be referenced by the web app or the UI library, so
 * the three catalogues only hold copy that ships. A key counts as referenced when its full path is
 * a string literal in the sources (`t('auth.login.title')`, a nav model's `labelKey`), or when its
 * namespace is a literal passed to `useTranslations`/`getTranslations` and the rest of the key is
 * a literal too (`useTranslations('shell')` + `t('menu')`). Keys built at run time
 * (`` t(`members.role_${role}`) ``) cannot be seen this way and are listed in `DYNAMIC_KEYS`.
 *
 * Tests (`*.test.*`) are not scanned: a key only a test mentions is still unused.
 *
 * Not scanned at all:
 * - `errors.*` — one message per API error code (`ERROR_CODES`, checked by locales.test.ts);
 * - `emails.*`, `sms.*` — rendered by the API's providers, not the web.
 */
const IGNORED_NAMESPACES = ['errors.', 'emails.', 'sms.'];

/** Prefixes of keys composed at run time; each entry names the call that builds it. */
const DYNAMIC_KEYS: readonly string[] = [
  'members.role_', // t(`members.role_${role}`) — members, home, workspaces, audit log
  'members.status_', // t(`members.status_${status}`) — members panel
  'abuse.category_', // t(`abuse.category_${category}`) — abuse report dialog and admin console
  'abuse.status_', // t(`abuse.status_${status}`) — admin abuse reports
  'admin.workspaceStatus.', // t(`admin.workspaceStatus.${status}`) — admin workspaces
  'workspace.status_', // t(`workspace.status_${status}`) — workspace layout
  'guardian.relationship_', // t(`guardian.relationship_${relationship}`) — guardian consent fields
  'guardian.status_', // t(`guardian.status_${link.status}`) — guardian panel, students panel
  'invitations.status_', // t(`invitations.status_${status}`) — invitations list
  'inviteLinks.status_', // t(`inviteLinks.status_${link.status}`) — invite-link card
  'validation.', // issuesToFieldErrors: t(`validation.${issue.code}`)
  'settings.nav.', // t(`settings.nav.${tab}`) — settings tabs
  'settings.consents.types.', // consentKey(type) — consents list
  'onboarding.', // t(`onboarding.${item.key}`) — onboarding checklist
  'legal.', // t(`legal.${document}.body`), t(`legal.${TITLE_KEYS[document]}`) — legal pages
  'landing.trust', // t(`landing.${key}`) over ['trustMobile', …] — landing page
  'landing.value', // t(`landing.value${n}Title`), t(`landing.value${n}Body`) — landing page
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE_DIRS = ['apps/web/src', 'packages/ui/src'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every string literal and substitution-free template literal in the scanned sources. */
function sourceLiterals(): Set<string> {
  const literals = new Set<string>();
  for (const dir of SOURCE_DIRS)
    for (const file of sourceFiles(join(ROOT, dir))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
          literals.add(node.text);
        node.forEachChild(visit);
      };
      visit(source);
    }
  return literals;
}

function isReferenced(key: string, literals: Set<string>): boolean {
  if (literals.has(key)) return true;
  const parts = key.split('.');
  for (let i = 1; i < parts.length; i++)
    if (literals.has(parts.slice(0, i).join('.')) && literals.has(parts.slice(i).join('.')))
      return true;
  return false;
}

function unusedKeys(keys: readonly string[], literals: Set<string>): string[] {
  return keys.filter(
    (key) =>
      !IGNORED_NAMESPACES.some((ns) => key.startsWith(ns)) &&
      !DYNAMIC_KEYS.some((prefix) => key.startsWith(prefix)) &&
      !isReferenced(key, literals),
  );
}

describe('catalogue keys', () => {
  it('flags a key nothing references, and accepts full paths and namespace + rest', () => {
    const literals = new Set(['auth.login.title', 'shell', 'menu']);
    expect(
      unusedKeys(
        ['auth.login.title', 'shell.menu', 'shell.gone', 'errors.X', 'members.role_OWNER'],
        literals,
      ),
    ).toEqual(['shell.gone']);
  });

  it('every key in the catalogue is referenced by apps/web or packages/ui', () => {
    expect(unusedKeys(flattenKeys(messages.fr), sourceLiterals())).toEqual([]);
  });

  it('every dynamic prefix still matches a key (no stale allow-list entries)', () => {
    const keys = flattenKeys(messages.fr);
    for (const prefix of DYNAMIC_KEYS)
      expect(
        keys.some((k) => k.startsWith(prefix)),
        prefix,
      ).toBe(true);
  });
});
