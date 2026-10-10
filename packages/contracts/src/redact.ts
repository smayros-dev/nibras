/**
 * Keys never written to logs in clear (API and worker loggers share this list). Header names are
 * the lower-case keys Node uses under `req.headers` / `res.headers`.
 */
export const REDACT_KEYS = [
  'email',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'totpSecret',
  'recoveryCodes',
  'code',
  'otp',
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
] as const;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `.key` for an identifier, `["set-cookie"]` otherwise (pino `redact` path syntax). */
function accessor(key: string): string {
  return IDENTIFIER.test(key) ? `.${key}` : `["${key}"]`;
}

/**
 * pino `redact.paths` for every `REDACT_KEYS` entry at the top level and nested up to `depth`
 * levels: `key`, `*.key`, `*.*.key`, ... (`*["set-cookie"]` for hyphenated keys), which covers
 * `req.headers.cookie` and `res.headers["set-cookie"]`.
 */
export function redactPaths(depth = 3): string[] {
  return REDACT_KEYS.flatMap((key) => {
    const paths = [IDENTIFIER.test(key) ? key : `["${key}"]`];
    for (let level = 1; level <= depth; level += 1) {
      paths.push(`${Array.from({ length: level }, () => '*').join('.')}${accessor(key)}`);
    }
    return paths;
  });
}
