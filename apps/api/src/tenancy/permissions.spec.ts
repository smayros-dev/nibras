import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/api-error';
import { RequestContext, type AuthUser, type RequestStore } from '../common/request-context';
import { assertOwn, currentGrant } from './permissions';

const USER_ID = '01900000-0000-7000-8000-000000000001';
const OTHER_ID = '01900000-0000-7000-8000-000000000002';

function store(extra: Partial<RequestStore> = {}): RequestStore {
  return {
    requestId: 'r',
    ip: '127.0.0.1',
    userAgent: 'vitest',
    user: { id: USER_ID } as AuthUser,
    ...extra,
  };
}

function denied(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('PERMISSION_DENIED');
    expect((err as ApiError).getStatus()).toBe(403);
    return;
  }
  throw new Error('expected PERMISSION_DENIED');
}

describe('assertOwn', () => {
  it('scope own: passes for the caller’s resource, 403 PERMISSION_DENIED for anyone else’s', () => {
    RequestContext.run(store({ permissionScope: 'own' }), () => {
      expect(() => assertOwn(USER_ID)).not.toThrow();
      denied(() => assertOwn(OTHER_ID));
      denied(() => assertOwn(null));
    });
  });

  it('scope all: any owner passes', () => {
    RequestContext.run(store({ permissionScope: 'all' }), () => {
      expect(() => assertOwn(OTHER_ID)).not.toThrow();
    });
  });

  it('fails closed without a scope or a user', () => {
    RequestContext.run(store(), () => {
      expect(() => assertOwn(USER_ID)).not.toThrow();
      denied(() => assertOwn(OTHER_ID));
    });
    RequestContext.run(store({ user: undefined, permissionScope: 'own' }), () => {
      denied(() => assertOwn(USER_ID));
    });
    denied(() => assertOwn(USER_ID));
  });
});

describe('self/child-qualified §7 cells', () => {
  const memberStore = (role: 'STUDENT' | 'GUARDIAN', p: 'student.read' | 'report.read') => {
    const s = store({
      workspace: { id: OTHER_ID, type: 'ORGANIZATION', status: 'ACTIVE' },
      membership: { id: OTHER_ID, role, canTeach: false, status: 'ACTIVE' },
    });
    // What PermissionGuard does for `@RequirePermission(p)`.
    RequestContext.run(s, () => {
      const grant = currentGrant(p);
      expect(grant).toBe('own');
      s.permissionScope = grant as 'own';
    });
    return s;
  };

  it('a STUDENT (scope own on student.read) passes for himself only', () => {
    RequestContext.run(memberStore('STUDENT', 'student.read'), () => {
      expect(() => assertOwn(USER_ID)).not.toThrow();
      denied(() => assertOwn(OTHER_ID));
    });
  });

  it('a GUARDIAN (scope own on report.read) fails closed for any other user until SP2 links children', () => {
    RequestContext.run(memberStore('GUARDIAN', 'report.read'), () => {
      denied(() => assertOwn(OTHER_ID));
    });
  });
});

describe('currentGrant', () => {
  it('reads the membership and workspace type from the request context', () => {
    const ctx = store({
      workspace: { id: OTHER_ID, type: 'ORGANIZATION', status: 'ACTIVE' },
      membership: { id: OTHER_ID, role: 'TEACHER', canTeach: false, status: 'ACTIVE' },
    });
    RequestContext.run(ctx, () => {
      expect(currentGrant('session.manage')).toBe('own');
      expect(currentGrant('workspace.settings.update')).toBe('none');
    });
    expect(currentGrant('abuse.report')).toBe('none');
  });
});
