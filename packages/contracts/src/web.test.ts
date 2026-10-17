import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Every module `file` reaches through relative imports, and every package it imports. */
function importGraph(file: string, seen = new Set<string>(), packages = new Set<string>()) {
  if (seen.has(file)) return { seen, packages };
  seen.add(file);
  const source = readFileSync(join(SRC, file), 'utf8');
  for (const [, type, spec] of source.matchAll(
    /^(?:import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/gms,
  )) {
    if (type || !spec) continue; // type-only imports are erased
    if (spec.startsWith('./')) importGraph(`${spec.slice(2)}.ts`, seen, packages);
    else packages.add(spec);
  }
  return { seen, packages };
}

describe('@tt/contracts/web', () => {
  it('never reaches zod (it ships in browser bundles; PRD §14.1 budget)', () => {
    const { seen, packages } = importGraph('web.ts');
    expect(seen.size).toBeGreaterThan(5);
    expect([...packages]).not.toContain('zod');
  });

  it('exports the same values as the main entry for the modules it carries', async () => {
    const web: Record<string, unknown> = await import('./web');
    const main: Record<string, unknown> = await import('./index');
    for (const [name, value] of Object.entries(web)) expect(main[name], name).toBe(value);
  });
});
