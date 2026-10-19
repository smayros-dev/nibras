import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Repo contract for `.github/workflows/*.yml` (SP1.6 F4): every `uses:` is pinned to a 40-hex
 * commit SHA (a tag can be moved by a compromised upstream) and carries a trailing `# vX.Y.Z`
 * comment so Dependabot and reviewers can read the version. Local actions (`./…`) and
 * `docker://` references are out of scope.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflowsDir = `${root}.github/workflows/`;
const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w.-]+)*@[0-9a-f]{40}$/;
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(['"]?)([^'"\s#]+)\1\s*(#.*)?$/;

interface UsesRef {
  file: string;
  line: number;
  value: string;
  comment: string | undefined;
}

function collectUses(file: string): UsesRef[] {
  const source = readFileSync(`${workflowsDir}${file}`, 'utf8');
  parse(source); // fails the suite on invalid YAML
  const refs: UsesRef[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    const match = USES_LINE.exec(text);
    if (!match) return;
    const value = match[2]!;
    if (value.startsWith('./') || value.startsWith('docker://')) return;
    refs.push({ file, line: index + 1, value, comment: match[3] });
  });
  return refs;
}

const files = readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f));
const refs = files.flatMap(collectUses);

describe('GitHub workflows', () => {
  it('has workflows to check', () => {
    expect(files).toContain('ci.yml');
    expect(files).toContain('deploy-staging.yml');
    expect(refs.length).toBeGreaterThan(0);
  });

  it('every uses: line is seen by the collector', () => {
    for (const file of files) {
      const source = readFileSync(`${workflowsDir}${file}`, 'utf8');
      const lines = source.split(/\r?\n/).filter((l) => /^\s*(-\s+)?uses:/.test(l));
      const local = lines.filter((l) => /uses:\s*['"]?(\.\/|docker:\/\/)/.test(l)).length;
      expect(refs.filter((r) => r.file === file)).toHaveLength(lines.length - local);
    }
  });

  it.each(refs.map((r) => [`${r.file}:${r.line} ${r.value}`, r] as const))(
    '%s is pinned by commit SHA with a version comment',
    (_label, ref) => {
      expect(ref.value).toMatch(PINNED);
      expect(ref.comment ?? '').toMatch(/^#\s*v\d/);
    },
  );
});
