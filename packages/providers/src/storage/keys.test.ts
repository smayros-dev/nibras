import { describe, expect, it } from 'vitest';

import { isStorageKeyOf, storageKeyFor } from './keys';

const wid = '0192f0c1-0000-7000-8000-000000000001';
const other = '0192f0c1-0000-7000-8000-000000000002';
const mediaId = '0192f0c1-0000-7000-8000-0000000000aa';

describe('storageKeyFor', () => {
  it('builds w/{wid}/{kind}/{mediaId}/{sanitised filename}', () => {
    expect(
      storageKeyFor({ workspaceId: wid, kind: 'PDF', mediaId, filename: 'Cours n°1 (été).PDF' }),
    ).toBe(`w/${wid}/pdf/${mediaId}/Cours_n_1_ete_.PDF`);
    expect(
      storageKeyFor({ workspaceId: wid, kind: 'VIDEO', mediaId, filename: '../../etc/passwd' }),
    ).toMatch(new RegExp(`^w/${wid}/video/${mediaId}/[A-Za-z0-9._-]+$`));
  });

  it('refuses ids that are not uuids (no path injection through the ids)', () => {
    expect(() =>
      storageKeyFor({ workspaceId: '../x', kind: 'PDF', mediaId, filename: 'a.pdf' }),
    ).toThrow();
    expect(() =>
      storageKeyFor({ workspaceId: wid, kind: 'PDF', mediaId: 'a/b', filename: 'a.pdf' }),
    ).toThrow();
  });
});

describe('isStorageKeyOf', () => {
  it('accepts a key of the workspace and rejects another workspace', () => {
    const key = storageKeyFor({ workspaceId: wid, kind: 'IMAGE', mediaId, filename: 'p.png' });
    expect(isStorageKeyOf(key, wid)).toBe(true);
    expect(isStorageKeyOf(key, other)).toBe(false);
    expect(isStorageKeyOf(`w/${wid}`, wid)).toBe(false);
    expect(isStorageKeyOf(`x/${wid}/pdf/${mediaId}/a.pdf`, wid)).toBe(false);
    expect(isStorageKeyOf(`w/${wid}/pdf/../../${other}/a.pdf`, wid)).toBe(false);
  });
});
