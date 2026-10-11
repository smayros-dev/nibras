import { randomUUID } from 'node:crypto';
import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';

/** The only algorithm signed and accepted (pinned: `alg: none` and HS384/512 never verify). */
const ALG = 'HS256';
const ISSUER = 'tt-api';
/** PRD §8.1.2: the access JWT lives 15 minutes. */
export const ACCESS_TTL_S = 15 * 60;
/** A 2FA login challenge lives 5 minutes. */
export const CHALLENGE_TTL_S = 5 * 60;
/** Accepted clock skew between API instances when checking `exp`/`iat`/`nbf`. */
export const CLOCK_TOLERANCE_S = 5;

export type TokenTyp = 'access' | '2fa';

export interface AccessPayload {
  typ: 'access';
  sub: string;
  /** `UserSession.id`: the guard checks it is still active on every request. */
  sid: string;
}

export interface ChallengePayload {
  typ: '2fa';
  sub: string;
  /** Single-use id of the challenge (Task 10 records consumed ones). */
  jti: string;
}

export type PayloadOf<T extends TokenTyp> = T extends 'access' ? AccessPayload : ChallengePayload;

/** Any verification failure: bad signature, wrong `typ`/audience/issuer, expired, malformed. */
export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid token: ${reason}`);
    this.name = 'InvalidTokenError';
  }
}

/**
 * Signs and verifies the API's JWTs (jose, HS256 with `JWT_SECRET`). The two kinds are kept apart
 * twice: a `typ` claim and a per-kind audience (`tt:access`, `tt:2fa`), both checked by
 * {@link verify}, so a 2FA challenge can never pass for an access token or the reverse.
 */
export class JwtService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    /** Clock (ms), injectable for tests. */
    private readonly now: () => number = Date.now,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  /** A random `jti` makes every access token unique, even two signed in the same second. */
  signAccess(claims: { sub: string; sid: string }): Promise<string> {
    return this.sign({ sid: claims.sid }, claims.sub, 'access', ACCESS_TTL_S, randomUUID());
  }

  signChallenge(claims: { sub: string; jti: string }): Promise<string> {
    return this.sign({}, claims.sub, '2fa', CHALLENGE_TTL_S, claims.jti);
  }

  /** The payload of a valid token of kind `expectedTyp`; throws {@link InvalidTokenError}. */
  async verify<T extends TokenTyp>(token: string, expectedTyp: T): Promise<PayloadOf<T>> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.key, {
        algorithms: [ALG],
        issuer: ISSUER,
        audience: audienceOf(expectedTyp),
        clockTolerance: CLOCK_TOLERANCE_S,
        currentDate: new Date(this.now()),
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (err) {
      // jose's messages may echo claim values; keep only the error class.
      throw new InvalidTokenError(err instanceof errors.JOSEError ? err.code : 'malformed');
    }
    if (payload.typ !== expectedTyp) throw new InvalidTokenError('typ');
    if (typeof payload.sub !== 'string') throw new InvalidTokenError('sub');
    if (expectedTyp === 'access') {
      if (typeof payload.sid !== 'string') throw new InvalidTokenError('sid');
      return { typ: 'access', sub: payload.sub, sid: payload.sid } as PayloadOf<T>;
    }
    if (typeof payload.jti !== 'string') throw new InvalidTokenError('jti');
    return { typ: '2fa', sub: payload.sub, jti: payload.jti } as PayloadOf<T>;
  }

  private sign(
    claims: Record<string, string>,
    sub: string,
    typ: TokenTyp,
    ttlS: number,
    jti?: string,
  ): Promise<string> {
    const iat = Math.floor(this.now() / 1000);
    const jwt = new SignJWT({ ...claims, typ })
      .setProtectedHeader({ alg: ALG, typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(audienceOf(typ))
      .setIssuedAt(iat)
      .setExpirationTime(iat + ttlS);
    if (jti !== undefined) jwt.setJti(jti);
    return jwt.sign(this.key);
  }
}

function audienceOf(typ: TokenTyp): string {
  return `tt:${typ}`;
}
