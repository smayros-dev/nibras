import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_BYTES } from './invite-constants';
import { ImportQuerySchema, ImportRequestSchema } from './imports';

describe('import schemas', () => {
  it('content > IMPORT_MAX_BYTES is refused', () => {
    expect(ImportRequestSchema.safeParse({ fileName: 'a.csv', content: 'email\n' }).success).toBe(
      true,
    );
    expect(
      ImportRequestSchema.safeParse({
        fileName: 'a.csv',
        content: 'x'.repeat(IMPORT_MAX_BYTES + 1),
      }).success,
    ).toBe(false);
  });

  it("ImportQuerySchema coerces 'true', and 'false' stays false", () => {
    expect(ImportQuerySchema.parse({ dryRun: 'true' }).dryRun).toBe(true);
    expect(ImportQuerySchema.parse({ dryRun: 'false' }).dryRun).toBe(false);
    expect(ImportQuerySchema.parse({}).dryRun).toBe(false);
    expect(ImportQuerySchema.safeParse({ dryRun: 'yes' }).success).toBe(false);
  });
});
