import { decodeProtectedHeader, decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { JwtService } from './jwt.service';

const SECRET = 'a-test-secret-that-is-long-enough-0123456789';

describe('JwtService', () => {
  const jwt = new JwtService(SECRET);

  it('signs HS256 access tokens of 15 minutes with typ access', async () => {
    const token = await jwt.signAccess({ sub: 'u1', sid: 's1' });
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({ sub: 'u1', sid: 's1', typ: 'access' });
    expect(claims.exp! - claims.iat!).toBe(15 * 60);
    await expect(jwt.verify(token, 'access')).resolves.toMatchObject({ sub: 'u1', sid: 's1' });
    // Unique even within the same second.
    expect(await jwt.signAccess({ sub: 'u1', sid: 's1' })).not.toBe(token);
  });

  it('signs 2fa challenges of 5 minutes carrying a jti', async () => {
    const token = await jwt.signChallenge({ sub: 'u1', jti: 'j1' });
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({ sub: 'u1', jti: 'j1', typ: '2fa' });
    expect(claims.exp! - claims.iat!).toBe(5 * 60);
    await expect(jwt.verify(token, '2fa')).resolves.toMatchObject({ sub: 'u1', jti: 'j1' });
  });

  it('never accepts one typ for the other', async () => {
    const access = await jwt.signAccess({ sub: 'u1', sid: 's1' });
    const challenge = await jwt.signChallenge({ sub: 'u1', jti: 'j1' });
    await expect(jwt.verify(challenge, 'access')).rejects.toThrow();
    await expect(jwt.verify(access, '2fa')).rejects.toThrow();
  });

  it('rejects tokens signed with another key, expired ones and garbage', async () => {
    const other = new JwtService('another-secret-that-is-long-enough-987654');
    await expect(
      jwt.verify(await other.signAccess({ sub: 'u', sid: 's' }), 'access'),
    ).rejects.toThrow();
    await expect(jwt.verify('nope', 'access')).rejects.toThrow();
    const past = new JwtService(SECRET, () => Date.now() - 16 * 60 * 1000);
    await expect(
      jwt.verify(await past.signAccess({ sub: 'u', sid: 's' }), 'access'),
    ).rejects.toThrow();
  });

  it('tolerates a few seconds of clock skew only', async () => {
    const skewed = new JwtService(SECRET, () => Date.now() - (15 * 60 + 3) * 1000);
    await expect(
      jwt.verify(await skewed.signAccess({ sub: 'u', sid: 's' }), 'access'),
    ).resolves.toBeTruthy();
  });
});
