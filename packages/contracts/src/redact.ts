/**
 * Keys never written to logs in clear (API and worker loggers share this list). Header names are
 * the lower-case keys Node uses under `req.headers` / `res.headers`. A bare `code` is deliberately
 * absent: it is the API error code and Prisma/Node `err.code`, which logs must keep. One-time codes
 * travel as `otpCode` / `verificationCode` / `recoveryCode`; a `code` field of a request body or a
 * job payload is still covered by `REDACT_SCOPED_PATHS`.
 */
export const REDACT_KEYS = [
  'email',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'totpSecret',
  'otpauthUrl',
  'challengeToken',
  'recoveryCodes',
  'otp',
  'otpCode',
  'verificationCode',
  'recoveryCode',
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
] as const;

/** `code` redacted only inside request bodies (`req.body`) and job payloads (`job.data`). */
export const REDACT_SCOPED_PATHS = [
  'body.code',
  '*.body.code',
  'data.code',
  '*.data.code',
] as const;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `.key` for an identifier, `["set-cookie"]` otherwise (pino `redact` path syntax). */
function accessor(key: string): string {
  return IDENTIFIER.test(key) ? `.${key}` : `["${key}"]`;
}

/**
 * pino `redact.paths` for every `REDACT_KEYS` entry at the top level and nested up to `depth`
 * levels: `key`, `*.key`, `*.*.key`, ... (`*["set-cookie"]` for hyphenated keys), which covers
 * `req.headers.cookie` and `res.headers["set-cookie"]`; followed by `REDACT_SCOPED_PATHS`.
 */
export function redactPaths(depth = 3): string[] {
  const keyPaths = REDACT_KEYS.flatMap((key) => {
    const paths = [IDENTIFIER.test(key) ? key : `["${key}"]`];
    for (let level = 1; level <= depth; level += 1) {
      paths.push(`${Array.from({ length: level }, () => '*').join('.')}${accessor(key)}`);
    }
    return paths;
  });
  return [...keyPaths, ...REDACT_SCOPED_PATHS];
}
