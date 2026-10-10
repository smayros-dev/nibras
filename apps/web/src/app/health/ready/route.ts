export const dynamic = 'force-dynamic';

/**
 * Readiness: the web app has no hard dependency (the API being down degrades pages, it does not
 * make this instance unable to serve), so it is ready as soon as it is up.
 */
export function GET() {
  return Response.json({ status: 'ok' });
}
