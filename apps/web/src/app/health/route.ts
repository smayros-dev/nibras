export const dynamic = 'force-dynamic';

/** Liveness of the web process (outside the locale routing). */
export function GET() {
  return Response.json({ status: 'ok' });
}
