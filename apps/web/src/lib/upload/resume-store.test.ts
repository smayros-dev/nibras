import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRecord,
  findResumable,
  loadRecord,
  markPartDone,
  saveRecord,
  type ResumeRecord,
} from './resume-store';

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const record = (extra: Partial<ResumeRecord> = {}): ResumeRecord => ({
  mediaId: 'm1',
  wid: 'w1',
  kind: 'PDF',
  fileName: 'cours.pdf',
  size: 20_000_000,
  lastModified: 1_700_000_000_000,
  done: [],
  partCount: 3,
  ...extra,
});

const file = { name: 'cours.pdf', size: 20_000_000, lastModified: 1_700_000_000_000 };

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('resume-store', () => {
  it('round-trips a record and its done parts', () => {
    const storage = new MemoryStorage();
    saveRecord(record(), storage);
    markPartDone('m1', 2, storage);
    markPartDone('m1', 1, storage);
    markPartDone('m1', 2, storage);
    expect(loadRecord('m1', storage)).toEqual(record({ done: [1, 2] }));
    expect([...storage.map.keys()]).toEqual(['nibras-upload:m1']);
    clearRecord('m1', storage);
    expect(loadRecord('m1', storage)).toBeNull();
  });

  it('matches a file by name, size and lastModified within the workspace and kind', () => {
    const storage = new MemoryStorage();
    saveRecord(record(), storage);
    saveRecord(record({ mediaId: 'm2', fileName: 'autre.pdf' }), storage);
    storage.setItem('nibras-upload:broken', '{nope');
    storage.setItem('other-key', '{}');
    expect(findResumable(file, { wid: 'w1', kind: 'PDF' }, storage)?.mediaId).toBe('m1');
    expect(findResumable({ ...file, size: 1 }, { wid: 'w1', kind: 'PDF' }, storage)).toBeNull();
    expect(
      findResumable({ ...file, lastModified: 1 }, { wid: 'w1', kind: 'PDF' }, storage),
    ).toBeNull();
    expect(findResumable(file, { wid: 'w2', kind: 'PDF' }, storage)).toBeNull();
    expect(findResumable(file, { wid: 'w1', kind: 'VIDEO' }, storage)).toBeNull();
  });

  it('is tolerant of a throwing or missing localStorage', () => {
    const throwing = {
      get length(): number {
        throw new Error('denied');
      },
      key: () => {
        throw new Error('denied');
      },
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => saveRecord(record(), throwing)).not.toThrow();
    expect(() => markPartDone('m1', 1, throwing)).not.toThrow();
    expect(loadRecord('m1', throwing)).toBeNull();
    expect(findResumable(file, { wid: 'w1', kind: 'PDF' }, throwing)).toBeNull();
    expect(() => clearRecord('m1', throwing)).not.toThrow();
    // The default storage: none in node, and an accessor that throws.
    expect(loadRecord('m1')).toBeNull();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(() => saveRecord(record())).not.toThrow();
    expect(findResumable(file, { wid: 'w1', kind: 'PDF' })).toBeNull();
  });
});
