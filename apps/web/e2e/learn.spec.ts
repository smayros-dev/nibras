import type { Page } from '@playwright/test';
import { appUrl, expect, t, test, uiLogin } from './helpers';
import { fill } from './helpers/invitations';
import {
  completeLesson,
  SAMPLE_PDF,
  seedClassroom,
  seedCourse,
  uploadFixture,
  type Classroom,
} from './helpers/media';

/**
 * SP3 student journeys (plan T17): module locks (AC-ENR-03 UI), a course unpublished under the
 * student's feet (AC-CRS-02 UI), the PDF lesson rendered by pdf.js from a presigned MinIO URL
 * (worker same-origin, CSP `connect-src`) with the download hidden when not allowed
 * (AC-MED-06 UI). Everything is seeded through the API.
 */

/** CSP violations reported by the page (console), e.g. a media origin missing from the CSP. */
function cspViolations(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) seen.push(msg.text());
  });
  return seen;
}

test.describe('student learning', () => {
  let room: Classroom;

  test.beforeEach(async () => {
    room = await seedClassroom();
  });

  test.afterEach(async () => {
    await room.dispose();
  });

  test('locked module 2 names module 1 and its percent; opening its lesson is refused; completing module 1 unlocks it (AC-ENR-03 UI)', async ({
    page,
    uiLocale: locale,
  }) => {
    test.setTimeout(120_000);
    const { teacher, student, studentCtx } = room;
    const course = await seedCourse(teacher.ctx, teacher.wid, {
      title: 'Algèbre — verrous',
      modules: [
        {
          title: 'Module 1',
          lessons: [
            { type: 'TEXT', title: 'Les nombres' },
            { type: 'TEXT', title: 'Les fractions' },
          ],
        },
        {
          title: 'Module 2',
          afterPrevious: true,
          lessons: [{ type: 'TEXT', title: 'Les équations', text: 'Résoudre x + 1 = 2.' }],
        },
      ],
      students: [student.userId],
    });
    const [m1, m2] = course.modules as [
      (typeof course.modules)[number],
      (typeof course.modules)[number],
    ];
    await completeLesson(studentCtx, m1.lessons[0]!.id);

    await uiLogin(page, locale, student);
    await page.goto(`/${locale}/app/courses`);
    await page.getByRole('link', { name: course.title }).first().click();
    await expect(page).toHaveURL(appUrl(`/${locale}/app/courses/${course.id}`));

    const lockText = fill(t(locale, 'learn.moduleLocked'), { title: m1.title, percent: '50' });
    const module2 = page.getByRole('region', { name: m2.title });
    await expect(module2.getByText(lockText)).toBeVisible();
    // A locked lesson is not a link.
    await expect(page.getByRole('link', { name: /Les équations/ })).toHaveCount(0);

    // Typing its URL is refused with the lock reason.
    await page.goto(`/${locale}/app/courses/${course.id}/lessons/${m2.lessons[0]!.id}`);
    await expect(page.getByRole('heading', { name: t(locale, 'learn.lockedTitle') })).toBeVisible();
    await expect(page.getByText(lockText)).toBeVisible();

    // Completing module 1 through the UI unlocks module 2.
    await page.goto(`/${locale}/app/courses/${course.id}/lessons/${m1.lessons[1]!.id}`);
    await page.getByRole('button', { name: t(locale, 'learn.markComplete') }).click();
    await expect(
      page.getByRole('status').getByText(t(locale, 'learn.status_COMPLETED')),
    ).toBeVisible();
    await page.goto(`/${locale}/app/courses/${course.id}`);
    await expect(page.getByText(lockText)).toHaveCount(0);
    await page.getByRole('link', { name: /Les équations/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Les équations' })).toBeVisible();
    await expect(page.getByText('Résoudre x + 1 = 2.')).toBeVisible();
  });

  test('PDF lesson renders with pdf.js from MinIO, download hidden when not allowed; unpublishing shows « Ce cours n’est plus disponible » on the next navigation (AC-MED-06, AC-CRS-02 UI)', async ({
    page,
    uiLocale: locale,
  }) => {
    test.setTimeout(120_000);
    const { teacher, student } = room;
    const pdf = await uploadFixture(teacher.ctx, teacher.wid, 'PDF', SAMPLE_PDF());
    const course = await seedCourse(teacher.ctx, teacher.wid, {
      title: 'Géométrie — PDF',
      modules: [
        {
          title: 'Chapitre 1',
          lessons: [
            { type: 'PDF', title: 'Le cours en PDF', mediaId: pdf, allowDownload: false },
            { type: 'TEXT', title: 'Exercices' },
          ],
        },
      ],
      students: [student.userId],
    });
    const [pdfLesson, textLesson] = course.modules[0]!.lessons as [
      { id: string; title: string },
      { id: string; title: string },
    ];
    const violations = cspViolations(page);

    await uiLogin(page, locale, student);
    await page.goto(`/${locale}/app/courses/${course.id}/lessons/${pdfLesson.id}`);
    const media = page.getByTestId('lesson-media');
    await expect(media).toHaveAttribute('data-kind', 'PDF');
    // Both pages render to a canvas (the pdf.js worker loaded from `_next/static`).
    const pages = media.getByTestId('pdf-page');
    await expect(pages).toHaveCount(2, { timeout: 20_000 });
    await expect
      .poll(
        () =>
          pages
            .first()
            .locator('canvas')
            .evaluate((c: HTMLCanvasElement) => c.width),
        {
          timeout: 20_000,
        },
      )
      .toBeGreaterThan(0);
    await expect(media.getByTestId('watermark')).toContainText(student.email);
    await expect(page.getByRole('button', { name: t(locale, 'learn.media.download') })).toHaveCount(
      0,
    );

    // The outline is open when the teacher unpublishes; the next navigation shows the refusal.
    await page.goto(`/${locale}/app/courses/${course.id}`);
    await expect(page.getByRole('link', { name: /Exercices/ })).toBeVisible();
    const unpublish = await teacher.ctx.post(
      `/api/v1/workspaces/${teacher.wid}/courses/${course.id}/unpublish`,
    );
    expect(unpublish.status()).toBe(200);
    await page.getByRole('link', { name: /Exercices/ }).click();
    await expect(page).toHaveURL(
      appUrl(`/${locale}/app/courses/${course.id}/lessons/${textLesson.id}`),
    );
    await expect(page.getByRole('heading', { name: t(locale, 'learn.unavailable') })).toBeVisible();
    await page.goto(`/${locale}/app/courses`);
    await expect(page.getByRole('link', { name: course.title })).toHaveCount(0);
    expect(violations, 'CSP violations').toEqual([]);
  });
});
