import { describe, expect, it } from 'vitest';
import {
  CreateLessonSchema,
  CreateModuleSchema,
  ReorderSchema,
  UnlockRuleSchema,
  UpdateLessonSchema,
  UpdateModuleSchema,
} from './structure';

const A = '0192f2a0-0000-7000-8000-00000000000a';
const B = '0192f2a0-0000-7000-8000-00000000000b';
const CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
};

describe('structure inputs', () => {
  it('CreateLessonSchema: VIDEO needs mediaAssetId and refuses content', () => {
    expect(CreateLessonSchema.safeParse({ type: 'VIDEO', title: 'V' }).success).toBe(false);
    expect(CreateLessonSchema.parse({ type: 'VIDEO', title: ' V ', mediaAssetId: A })).toEqual({
      type: 'VIDEO',
      title: 'V',
      mediaAssetId: A,
    });
    expect(
      CreateLessonSchema.safeParse({ type: 'VIDEO', title: 'V', mediaAssetId: A, content: CONTENT })
        .success,
    ).toBe(false);
    expect(
      CreateLessonSchema.safeParse({
        type: 'VIDEO',
        title: 'V',
        mediaAssetId: A,
        allowDownload: true,
      }).success,
    ).toBe(false);
  });

  it('CreateLessonSchema: PDF accepts allowDownload, TEXT needs content', () => {
    expect(
      CreateLessonSchema.parse({ type: 'PDF', title: 'P', mediaAssetId: A, allowDownload: true }),
    ).toMatchObject({ type: 'PDF', allowDownload: true });
    expect(CreateLessonSchema.safeParse({ type: 'TEXT', title: 'T' }).success).toBe(false);
    expect(CreateLessonSchema.parse({ type: 'TEXT', title: 'T', content: CONTENT })).toMatchObject({
      type: 'TEXT',
    });
    expect(
      CreateLessonSchema.safeParse({ type: 'TEXT', title: 'T', content: CONTENT, mediaAssetId: A })
        .success,
    ).toBe(false);
  });

  it('CreateLessonSchema refuses the P1 lesson types', () => {
    for (const type of ['LINK', 'EMBED', 'QUIZ', 'ASSIGNMENT'])
      expect(CreateLessonSchema.safeParse({ type, title: 'X' }).success).toBe(false);
  });

  it('UpdateLessonSchema: every field optional, type immutable, at least one key', () => {
    expect(UpdateLessonSchema.parse({ title: 'N' })).toEqual({ title: 'N' });
    expect(UpdateLessonSchema.safeParse({}).success).toBe(false);
    expect(UpdateLessonSchema.safeParse({ type: 'PDF' }).success).toBe(false);
    expect(
      UpdateLessonSchema.safeParse({ content: { type: 'doc', content: [{ type: 'x' }] } }).success,
    ).toBe(false);
  });

  it('UnlockRuleSchema refuses the P1 rules; CreateModuleSchema defaults NONE', () => {
    expect(UnlockRuleSchema.parse({ type: 'PREVIOUS_MODULE_COMPLETED' })).toEqual({
      type: 'PREVIOUS_MODULE_COMPLETED',
    });
    expect(
      UnlockRuleSchema.safeParse({ type: 'AFTER_DATE', date: '2026-11-01T00:00:00Z' }).success,
    ).toBe(false);
    expect(CreateModuleSchema.parse({ title: 'M1' })).toEqual({
      title: 'M1',
      unlockRule: { type: 'NONE' },
    });
    expect(CreateModuleSchema.safeParse({ title: 'M1', position: 2 }).success).toBe(false);
    expect(UpdateModuleSchema.safeParse({}).success).toBe(false);
    expect(UpdateModuleSchema.parse({ isOptional: true })).toEqual({ isOptional: true });
  });

  it('ReorderSchema refuses duplicates, empty lists and non-uuids', () => {
    expect(ReorderSchema.parse({ ids: [A, B] })).toEqual({ ids: [A, B] });
    expect(ReorderSchema.safeParse({ ids: [A, A] }).success).toBe(false);
    expect(ReorderSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(ReorderSchema.safeParse({ ids: ['x'] }).success).toBe(false);
  });
});
