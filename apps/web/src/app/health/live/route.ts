export const dynamic = 'force-dynamic';

/** Liveness: the web process is up. */
export function GET() {
  return Response.json({ status: 'ok' });
}
