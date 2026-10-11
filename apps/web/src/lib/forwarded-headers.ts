/**
 * Incoming request headers a server-side API call forwards: the session `cookie`, the client
 * address chain (`x-forwarded-for`, as received; the API's `TRUST_PROXY_HOPS` decides which entry
 * is the client), the `x-request-id` (one id across web and API logs) and `accept-language`.
 */
export const FORWARDED_HEADERS = ['cookie', 'x-forwarded-for', 'x-request-id', 'accept-language'];

/** Copies the `FORWARDED_HEADERS` present in `incoming` onto `outgoing` (overwriting them). */
export function forwardHeaders(incoming: Pick<Headers, 'get'>, outgoing: Headers): Headers {
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name);
    if (value) outgoing.set(name, value);
  }
  return outgoing;
}
