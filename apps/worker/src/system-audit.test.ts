import { describe, expect, it, vi } from 'vitest';

import { writeSystemAudit, type SystemAuditDb } from './system-audit';

function fakeDb(fail = false) {
  const create = vi.fn((_args: unknown) =>
    fail ? Promise.reject(new Error('db down')) : Promise.resolve({}),
  );
  return { db: { auditLog: { create } } as unknown as SystemAuditDb, create };
}

const logger = () => ({ error: vi.fn() });

describe('writeSystemAudit', () => {
  it('writes a SYSTEM row (no actor) with requestId job:{id}, without secret keys at any depth', async () => {
    const { db, create } = fakeDb();
    await writeSystemAudit(
      db,
      {
        workspaceId: '0192f0f0-0000-7000-8000-000000000001',
        action: 'guardian.consent_expired',
        entityType: 'GuardianLink',
        entityId: '0192f0f0-0000-7000-8000-000000000002',
        before: { consentTokenHash: 'abc', status: 'PENDING' },
        after: {
          email: 'kept@example.com',
          tokenHash: 'x',
          nested: { sessionsViewTokenHash: 'y', password: 'p', otpCode: '1', ok: 1 },
          at: new Date('2026-10-19T03:00:00.000Z'),
        },
      },
      'guardian-consent-expire:1',
      logger(),
    );
    expect(create).toHaveBeenCalledTimes(1);
    const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).toEqual({
      workspaceId: '0192f0f0-0000-7000-8000-000000000001',
      actorUserId: null,
      actorRole: 'SYSTEM',
      action: 'guardian.consent_expired',
      entityType: 'GuardianLink',
      entityId: '0192f0f0-0000-7000-8000-000000000002',
      before: { status: 'PENDING' },
      after: {
        email: 'kept@example.com',
        nested: { ok: 1 },
        at: '2026-10-19T03:00:00.000Z',
      },
      requestId: 'job:guardian-consent-expire:1',
    });
  });

  it('never throws: a failed write is logged with identifiers only', async () => {
    const { db } = fakeDb(true);
    const log = logger();
    await expect(
      writeSystemAudit(
        db,
        { workspaceId: null, action: 'invitation.expired', entityType: 'Invitation', after: {} },
        '7',
        log,
      ),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = log.error.mock.calls[0]! as [Record<string, unknown>, string];
    expect(msg).toBe('audit write failed');
    expect(fields).toMatchObject({ action: 'invitation.expired', jobId: '7' });
    expect(JSON.stringify(fields)).not.toContain('db down');
  });
});
