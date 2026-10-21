import { writeFileSync } from 'node:fs';
import type { Page, Request } from '@playwright/test';
import { expect, t, test, uiLogin } from './helpers';
import { seedTeacher, type Teacher } from './helpers/invitations';
import { createCourse, fixture, paddedPdf, type SeededCourse } from './helpers/media';
import { setQuotaAsSuperAdmin } from './helpers/super-admin';

/**
 * SP3 uploads through the real UI to the compose MinIO (presigned S3 multipart, CSP
 * `connect-src`): a PDF upload cut after its first part resumes after a reload without re-sending
 * that part (AC-MED-01 UI); an executable renamed `.pdf` is refused at `complete` with `415` and the
 * detected type (AC-MED-04 UI); an upload over the quota shows the usage (AC-MED-07 UI, quota
 * lowered through the admin API).
 */

const MINIO = 'http://localhost:9000/';
const MIB = 1024 * 1024;

/** The `partNumber` of a presigned part `PUT`, else null. */
function partOf(request: Request): number | null {
  if (request.method() !== 'PUT' || !request.url().startsWith(MINIO)) return null;
  const n = new URL(request.url()).searchParams.get('partNumber');
  return n ? Number(n) : null;
}

/** Open « Ajouter une leçon » → PDF → « Envoyer un fichier » on the course's first module. */
async function openPdfUpload(page: Page, locale: string, teacher: Teacher, course: SeededCourse) {
  await page.goto(`/${locale}/app/w/${teacher.wid}/courses/${course.id}`);
  await page.getByRole('button', { name: t(locale, 'structure.addLesson') }).click();
  const lessonDialog = page.getByRole('dialog', { name: t(locale, 'structure.lessonCreateTitle') });
  await lessonDialog.getByRole('radio', { name: t(locale, 'structure.type_PDF') }).check();
  await lessonDialog.getByRole('button', { name: t(locale, 'structure.uploadFile') }).click();
  const upload = page.getByRole('dialog', { name: t(locale, 'upload.title_PDF') });
  await expect(upload).toBeVisible();
  return { lessonDialog, upload };
}

test.describe('media uploads', () => {
  let teacher: Teacher;
  let course: SeededCourse;

  test.beforeEach(async () => {
    teacher = await seedTeacher();
    course = await createCourse(teacher.ctx, teacher.wid, {
      title: 'Cours avec fichiers',
      modules: [{ title: 'Module 1', lessons: [] }],
    });
  });

  test.afterEach(async () => {
    await teacher.ctx.dispose();
  });

  test('a PDF upload cut after part 1 resumes after a reload, without re-sending part 1 (AC-MED-01 UI)', async ({
    page,
    uiLocale: locale,
  }, testInfo) => {
    test.setTimeout(150_000);
    // 3 parts of 8 MiB (the last one smaller); a file on disk keeps its lastModified across picks.
    const file = testInfo.outputPath('cours-long.pdf');
    writeFileSync(file, paddedPdf(17 * MIB));

    let cut = true;
    const sent: number[] = [];
    await page.route(`${MINIO}**`, async (route) => {
      const part = partOf(route.request());
      if (part === null) return route.continue();
      if (cut && part !== 1) return route.abort('connectionreset');
      sent.push(part);
      return route.continue();
    });

    await uiLogin(page, locale, teacher.user);
    const first = await openPdfUpload(page, locale, teacher, course);
    let upload = first.upload;
    await upload.getByLabel(t(locale, 'upload.fieldFile')).setInputFiles(file);
    await upload.getByRole('button', { name: t(locale, 'upload.start') }).click();
    // Parts 2 and 3 fail after their retries: the dialog offers to resume.
    await expect(upload.getByText(t(locale, 'upload.failed'))).toBeVisible({ timeout: 60_000 });
    await expect(upload.getByRole('button', { name: t(locale, 'upload.resume') })).toBeVisible();
    expect(sent).toEqual([1]);

    // Reload, pick the same file: the interrupted upload is found.
    cut = false;
    sent.length = 0;
    await page.reload();
    const second = await openPdfUpload(page, locale, teacher, course);
    upload = second.upload;
    const lessonDialog = second.lessonDialog;
    await upload.getByLabel(t(locale, 'upload.fieldFile')).setInputFiles(file);
    await expect(upload.getByText(/33/)).toBeVisible();
    await upload.getByRole('button', { name: t(locale, 'upload.resume') }).click();
    await expect(upload).toBeHidden({ timeout: 60_000 });
    expect(sent.sort()).toEqual([2, 3]);

    // The asset is picked in the lesson dialog; the lesson is created and its media turns READY.
    await lessonDialog.getByLabel(t(locale, 'structure.fieldTitle')).fill('Le polycopié');
    await lessonDialog.getByRole('button', { name: t(locale, 'structure.create') }).click();
    await expect(lessonDialog).toBeHidden();
    const row = page.getByRole('listitem').filter({ hasText: 'Le polycopié' });
    await expect(row.getByText(t(locale, 'upload.status_READY'))).toBeVisible({ timeout: 30_000 });
  });

  test('an executable renamed .pdf is refused (415, detected type); over the quota the usage is shown (AC-MED-04, AC-MED-07 UI)', async ({
    page,
    uiLocale: locale,
  }) => {
    test.setTimeout(120_000);
    await uiLogin(page, locale, teacher.user);
    const { upload } = await openPdfUpload(page, locale, teacher, course);

    await upload.getByLabel(t(locale, 'upload.fieldFile')).setInputFiles({
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: fixture('not-a-pdf.bin'),
    });
    const complete = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/media\/[^/]+\/complete$/.test(r.url()),
    );
    await upload.getByRole('button', { name: t(locale, 'upload.start') }).click();
    expect((await complete).status()).toBe(415);
    const [signatureLead] = t(locale, 'upload.signature').split('{detected}');
    await expect(upload.getByRole('alert')).toContainText(signatureLead!.trim());

    // Quota lowered to 1 MiB: a 2 MiB PDF is refused before any byte is sent.
    await setQuotaAsSuperAdmin(teacher.wid, MIB);
    await upload.getByLabel(t(locale, 'upload.fieldFile')).setInputFiles({
      name: 'gros.pdf',
      mimeType: 'application/pdf',
      buffer: paddedPdf(2 * MIB),
    });
    const ticket = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/media/uploads'),
    );
    await upload.getByRole('button', { name: t(locale, 'upload.start') }).click();
    expect((await ticket).status()).toBe(402);
    const [quotaLead] = t(locale, 'upload.quota').split('{used}');
    await expect(upload.getByRole('alert')).toContainText(quotaLead!.trim());
    await expect(upload.getByRole('alert')).toContainText(/1(\.|,|٫)?0* ?(Mo|MB|MiB|م)/);
  });
});
