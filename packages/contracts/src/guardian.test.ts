import { describe, expect, it } from 'vitest';
import { GuardianDecisionSchema, GuardianRegrantSchema } from './guardian';

const BASE = { guardianFirstName: 'Fatma', guardianLastName: 'Trabelsi', relationship: 'PARENT' };

describe('guardian schemas', () => {
  it('GRANT without acceptNotice → issue on acceptNotice; REFUSE without it passes', () => {
    const grant = GuardianDecisionSchema.safeParse({ ...BASE, decision: 'GRANT' });
    expect(grant.success).toBe(false);
    expect(grant.error?.issues[0]?.path).toEqual(['acceptNotice']);
    expect(
      GuardianDecisionSchema.safeParse({ ...BASE, decision: 'GRANT', acceptNotice: true }).success,
    ).toBe(true);
    expect(GuardianDecisionSchema.safeParse({ ...BASE, decision: 'REFUSE' }).success).toBe(true);
    expect(
      GuardianDecisionSchema.safeParse({ ...BASE, decision: 'REFUSE', extra: 1 }).success,
    ).toBe(false);
  });

  it('a re-grant always requires the notice', () => {
    expect(GuardianRegrantSchema.safeParse(BASE).success).toBe(false);
    expect(GuardianRegrantSchema.safeParse({ ...BASE, acceptNotice: true }).success).toBe(true);
    expect(
      GuardianRegrantSchema.safeParse({ ...BASE, acceptNotice: true, decision: 'GRANT' }).success,
    ).toBe(false);
  });
});
