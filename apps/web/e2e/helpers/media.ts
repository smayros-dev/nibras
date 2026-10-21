import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { apiLogin, expect } from '../helpers';
import { seedTeacher, type Teacher } from './invitations';
import { sleep } from './retry';
import { joinByInvitation, seedUser, type SeededUser } from './seed';

/**
 * SP3 e2e seeds through the real API (no psql): uploads go through the S3 multipart flow to the
 * compose MinIO (`PUT`s on the presigned part URLs, as the browser does), the worker turns them
 * `READY`, courses are built, published and assigned with `If-Match`.
 *
 * Fixtures (`e2e/fixtures/`, committed):
 * - `sample.pdf` — 2 text pages (pdf-lib);
 * - `sample.mp4` — 4 s 320×180 VP9 in MP4, `+faststart`
 *   (`ffmpeg -f lavfi -i testsrc2=size=320x180:rate=15:duration=4 -c:v libvpx-vp9 -b:v 120k
 *   -pix_fmt yuv420p -an -movflags +faststart sample.mp4`): Playwright's Chromium has no
 *   proprietary codecs (no H.264), VP9 in MP4 plays and still passes the API's MP4 probe;
 * - `sample.png` — 1×1;
 * - `not-a-pdf.bin` — a Windows executable header (`MZ`), refused at `complete`.
 */

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function fixturePath(name: string): string {
  return `${FIXTURES_DIR}${name}`;
}

export function fixture(name: string): Buffer {
  return readFileSync(fixturePath(name));
}

export type UploadKind = 'VIDEO' | 'PDF' | 'IMAGE';

export interface UploadFile {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export const SAMPLE_PDF = (): UploadFile => ({
  filename: 'sample.pdf',
  mimeType: 'application/pdf',
  bytes: fixture('sample.pdf'),
});

export const SAMPLE_MP4 = (): UploadFile => ({
  filename: 'sample.mp4',
  mimeType: 'video/mp4',
  bytes: fixture('sample.mp4'),
});

/** A valid PDF padded with spaces after `%%EOF` to `size` bytes (readers stop at the trailer). */
export function paddedPdf(size: number): Buffer {
  const pdf = fixture('sample.pdf');
  return Buffer.concat([pdf, Buffer.alloc(Math.max(0, size - pdf.length), 0x20)]);
}

interface Ticket {
  mode: 'S3_MULTIPART' | 'TUS';
  mediaId: string;
  partSizeBytes: number;
  parts: { partNumber: number; url: string }[];
}

interface Asset {
  id: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETING';
}

/**
 * Upload `file` as `kind` in `wid` through the API (ticket, presigned `PUT`s, `complete`) and wait
 * for the worker to make it `READY`. `ctx` is signed in as a verified teacher of `wid`.
 */
export async function uploadFixture(
  ctx: APIRequestContext,
  wid: string,
  kind: UploadKind,
  file: UploadFile,
): Promise<string> {
  const res = await ctx.post(`/api/v1/workspaces/${wid}/media/uploads`, {
    data: {
      kind,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.length,
    },
  });
  if (res.status() !== 201) throw new Error(`uploads ${res.status()}: ${await res.text()}`);
  const ticket = (await res.json()) as Ticket;
  if (ticket.mode !== 'S3_MULTIPART') throw new Error(`unexpected upload mode ${ticket.mode}`);
  const parts: { partNumber: number; etag: string }[] = [];
  for (const { partNumber, url } of ticket.parts) {
    const start = (partNumber - 1) * ticket.partSizeBytes;
    const body = new Uint8Array(file.bytes.subarray(start, start + ticket.partSizeBytes));
    const put = await fetch(url, { method: 'PUT', body });
    if (!put.ok) throw new Error(`PUT part ${partNumber}: ${put.status}`);
    parts.push({ partNumber, etag: put.headers.get('etag') ?? '' });
  }
  const done = await ctx.post(`/api/v1/workspaces/${wid}/media/${ticket.mediaId}/complete`, {
    data: { parts },
  });
  if (done.status() !== 200) throw new Error(`complete ${done.status()}: ${await done.text()}`);
  await waitForReady(ctx, wid, ticket.mediaId);
  return ticket.mediaId;
}

/** Poll `GET …/media/{id}` until the worker made it `READY` (fails on `FAILED`). */
export async function waitForReady(
  ctx: APIRequestContext,
  wid: string,
  mediaId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await ctx.get(`/api/v1/workspaces/${wid}/media/${mediaId}`);
    expect(res.status()).toBe(200);
    const asset = (await res.json()) as Asset;
    if (asset.status === 'READY') return;
    if (asset.status === 'FAILED' || Date.now() > deadline) {
      throw new Error(`media ${mediaId} is ${asset.status}: ${JSON.stringify(asset)}`);
    }
    await sleep(500);
  }
}

/** The course's current version (`If-Match` of the next write). */
export async function courseVersion(
  ctx: APIRequestContext,
  wid: string,
  cid: string,
): Promise<number> {
  const res = await ctx.get(`/api/v1/workspaces/${wid}/courses/${cid}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

/** A one-paragraph rich-text document. */
export function textDoc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

export type LessonSpec =
  | { type: 'TEXT'; title: string; text?: string; isRequired?: boolean }
  | { type: 'PDF'; title: string; mediaId: string; allowDownload?: boolean }
  | { type: 'VIDEO'; title: string; mediaId: string };

export interface ModuleSpec {
  title: string;
  isOptional?: boolean;
  afterPrevious?: boolean;
  lessons: LessonSpec[];
}

export interface SeededCourse {
  id: string;
  title: string;
  modules: { id: string; title: string; lessons: { id: string; title: string }[] }[];
}

/** Create a DRAFT course (and its modules and lessons), returning ids in order. */
export async function createCourse(
  ctx: APIRequestContext,
  wid: string,
  opts: { title: string; sequentialLessons?: boolean; modules?: ModuleSpec[] },
): Promise<SeededCourse> {
  const created = await ctx.post(`/api/v1/workspaces/${wid}/courses`, {
    data: {
      title: opts.title,
      language: 'fr',
      ...(opts.sequentialLessons ? { sequentialLessons: true } : {}),
    },
  });
  if (created.status() !== 201)
    throw new Error(`create course ${created.status()}: ${await created.text()}`);
  const course = (await created.json()) as { id: string; version: number };
  let version = course.version;
  const modules: SeededCourse['modules'] = [];
  for (const m of opts.modules ?? []) {
    const res = await ctx.post(`/api/v1/workspaces/${wid}/courses/${course.id}/modules`, {
      headers: ifMatch(version),
      data: {
        title: m.title,
        ...(m.isOptional ? { isOptional: true } : {}),
        unlockRule: { type: m.afterPrevious ? 'PREVIOUS_MODULE_COMPLETED' : 'NONE' },
      },
    });
    if (res.status() !== 201) throw new Error(`module ${res.status()}: ${await res.text()}`);
    const mod = (await res.json()) as { id: string };
    version = await courseVersion(ctx, wid, course.id);
    const lessons: { id: string; title: string }[] = [];
    for (const l of m.lessons) {
      const data =
        l.type === 'TEXT'
          ? {
              type: 'TEXT',
              title: l.title,
              content: textDoc(l.text ?? `Contenu de ${l.title}`),
              ...(l.isRequired === false ? { isRequired: false } : {}),
            }
          : l.type === 'PDF'
            ? {
                type: 'PDF',
                title: l.title,
                mediaAssetId: l.mediaId,
                allowDownload: l.allowDownload ?? false,
              }
            : { type: 'VIDEO', title: l.title, mediaAssetId: l.mediaId };
      const lr = await ctx.post(`/api/v1/workspaces/${wid}/modules/${mod.id}/lessons`, {
        headers: ifMatch(version),
        data,
      });
      if (lr.status() !== 201) throw new Error(`lesson ${lr.status()}: ${await lr.text()}`);
      lessons.push({ id: ((await lr.json()) as { id: string }).id, title: l.title });
      version = await courseVersion(ctx, wid, course.id);
    }
    modules.push({ id: mod.id, title: m.title, lessons });
  }
  return { id: course.id, title: opts.title, modules };
}

export async function publishCourse(ctx: APIRequestContext, wid: string, cid: string) {
  const res = await ctx.post(`/api/v1/workspaces/${wid}/courses/${cid}/publish`);
  if (res.status() !== 200) throw new Error(`publish ${res.status()}: ${await res.text()}`);
}

export async function enroll(
  ctx: APIRequestContext,
  wid: string,
  cid: string,
  studentUserIds: string[],
) {
  const res = await ctx.post(`/api/v1/workspaces/${wid}/courses/${cid}/enrollments`, {
    data: { studentUserIds },
  });
  if (res.status() !== 200) throw new Error(`enroll ${res.status()}: ${await res.text()}`);
}

/**
 * `seedCourse` of the plan: a course built, published and assigned in one call.
 */
export async function seedCourse(
  ctx: APIRequestContext,
  wid: string,
  opts: {
    title: string;
    sequentialLessons?: boolean;
    modules: ModuleSpec[];
    students?: string[];
  },
): Promise<SeededCourse> {
  const course = await createCourse(ctx, wid, opts);
  await publishCourse(ctx, wid, course.id);
  if (opts.students?.length) await enroll(ctx, wid, course.id, opts.students);
  return course;
}

/** Complete a lesson as the student signed in on `ctx` (opens it first, as the page does). */
export async function completeLesson(ctx: APIRequestContext, lid: string) {
  await ctx.post(`/api/v1/me/lessons/${lid}/opened`);
  const res = await ctx.post(`/api/v1/me/lessons/${lid}/complete`);
  if (res.status() !== 200) throw new Error(`complete ${res.status()}: ${await res.text()}`);
}

export interface Classroom {
  teacher: Teacher;
  student: SeededUser;
  /** The student signed in on his own request context. */
  studentCtx: APIRequestContext;
  dispose: () => Promise<void>;
}

/** A verified teacher (personal workspace) and one adult student who joined it by invitation. */
export async function seedClassroom(): Promise<Classroom> {
  const teacher = await seedTeacher();
  const student = await seedUser();
  await joinByInvitation(teacher.ctx, teacher.wid, student, 'STUDENT');
  const studentCtx = await playwrightRequest.newContext({ baseURL: 'http://localhost:3000' });
  await apiLogin(studentCtx, student);
  return {
    teacher,
    student,
    studentCtx,
    dispose: async () => {
      await studentCtx.dispose();
      await teacher.ctx.dispose();
    },
  };
}
