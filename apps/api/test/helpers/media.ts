import type { Response } from 'supertest';
import { expect } from 'vitest';
import type { as } from './auth';

type Agent = ReturnType<typeof as>;

export interface UploadInput {
  kind: 'VIDEO' | 'PDF' | 'IMAGE' | 'FILE';
  filename: string;
  mimeType: string;
  bytes: Buffer;
  /** Declared size (default: the real one). */
  sizeBytes?: number;
}

/** An S3 multipart ticket as `POST …/media/uploads` returns it. */
export interface S3Ticket {
  mode: 'S3_MULTIPART';
  mediaId: string;
  partSizeBytes: number;
  partCount: number;
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

export const mediaUrl = (wid: string, path = '') => `/api/v1/workspaces/${wid}/media${path}`;

/** `PUT` one part to its presigned URL (what the browser does); the part's `ETag`. */
export async function putPart(url: string, body: Uint8Array): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body });
  expect(res.status, `PUT part: ${await res.clone().text()}`).toBe(200);
  const etag = res.headers.get('etag');
  expect(etag).toBeTruthy();
  return etag!;
}

/** The bytes of part `partNumber` (1-based) of `bytes` cut in `partSize` slices. */
export const partBytes = (bytes: Buffer, partSize: number, partNumber: number): Buffer =>
  bytes.subarray((partNumber - 1) * partSize, partNumber * partSize);

/** `POST …/media/uploads` → `201` and the ticket. */
export async function createTicket(
  agent: Agent,
  wid: string,
  input: UploadInput,
): Promise<S3Ticket> {
  const res = await agent.post(mediaUrl(wid, '/uploads')).send({
    kind: input.kind,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes ?? input.bytes.length,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as S3Ticket;
}

/**
 * The browser's whole S3 upload through the API: the ticket, one `PUT` per part (presigned URLs
 * of the ticket), then `complete` with the ETags. Returns the ticket and the raw `complete`
 * response (specs assert its status).
 */
export async function uploadThroughApi(
  agent: Agent,
  wid: string,
  input: UploadInput,
): Promise<{ mediaId: string; ticket: S3Ticket; complete: Response }> {
  const ticket = await createTicket(agent, wid, input);
  expect(ticket.mode).toBe('S3_MULTIPART');
  const parts: { partNumber: number; etag: string }[] = [];
  for (const { partNumber, url } of ticket.parts) {
    const etag = await putPart(url, partBytes(input.bytes, ticket.partSizeBytes, partNumber));
    parts.push({ partNumber, etag });
  }
  const complete = await agent.post(mediaUrl(wid, `/${ticket.mediaId}/complete`)).send({ parts });
  return { mediaId: ticket.mediaId, ticket, complete };
}
