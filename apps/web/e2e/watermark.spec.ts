import type { Locator, Page } from '@playwright/test';
import { expect, t, test, uiLogin } from './helpers';
import { fill } from './helpers/invitations';
import {
  SAMPLE_MP4,
  SAMPLE_PDF,
  seedClassroom,
  seedCourse,
  uploadFixture,
  type Classroom,
} from './helpers/media';

/**
 * AC-MED-09 (D-O8: no DRM, a visible moving watermark): the video and PDF lessons carry the
 * student's email over the media; `page.clock` fast-forwards past `WATERMARK_MOVE_MS` (30 s) and
 * the overlay moves; it stays inside the fullscreen element and no player control removes it.
 * The video is a real VP9-in-MP4 played from its presigned MinIO URL (`media-src`).
 * Runs on chromium-fr, chromium-ar and mobile-ar.
 */

async function expectOverlay(watermark: Locator, email: string) {
  await expect(watermark).toBeVisible();
  await expect(watermark).toContainText(email);
  await expect(watermark).toHaveAttribute('aria-hidden', 'true');
  expect(await watermark.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
}

async function expectMoves(page: Page, watermark: Locator) {
  const before = await watermark.getAttribute('data-position');
  await page.clock.fastForward(31_000);
  await expect(watermark).not.toHaveAttribute('data-position', before ?? '');
}

test.describe('media watermark', () => {
  let room: Classroom;

  test.beforeEach(async () => {
    room = await seedClassroom();
  });

  test.afterEach(async () => {
    await room.dispose();
  });

  test('video and PDF lessons show the student email, move after 31 s and stay in fullscreen (AC-MED-09)', async ({
    page,
    uiLocale: locale,
  }) => {
    test.setTimeout(150_000);
    const { teacher, student } = room;
    const video = await uploadFixture(teacher.ctx, teacher.wid, 'VIDEO', SAMPLE_MP4());
    const pdf = await uploadFixture(teacher.ctx, teacher.wid, 'PDF', SAMPLE_PDF());
    const course = await seedCourse(teacher.ctx, teacher.wid, {
      title: 'Physique — médias',
      modules: [
        {
          title: 'Chapitre 1',
          lessons: [
            { type: 'VIDEO', title: 'La vidéo du cours', mediaId: video },
            { type: 'PDF', title: 'Le polycopié', mediaId: pdf },
          ],
        },
      ],
      students: [student.userId],
    });
    const [videoLesson, pdfLesson] = course.modules[0]!.lessons as [
      { id: string; title: string },
      { id: string; title: string },
    ];

    await page.clock.install();
    await uiLogin(page, locale, student);

    // --- Video: real playback from the presigned MinIO URL.
    await page.goto(`/${locale}/app/courses/${course.id}/lessons/${videoLesson.id}`);
    const player = page.getByRole('region', {
      name: fill(t(locale, 'learn.media.player'), { title: videoLesson.title }),
    });
    const element = player.getByTestId('video');
    await expect
      .poll(() => element.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);
    await player.getByRole('button', { name: t(locale, 'learn.media.play') }).click();
    await expect
      .poll(() => element.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 })
      .toBeGreaterThan(0.2);
    expect(
      await element.evaluate((v: HTMLVideoElement) => ({
        error: v.error?.code ?? null,
        width: v.videoWidth,
        src: v.currentSrc.startsWith('http://localhost:9000/'),
      })),
    ).toEqual({ error: null, width: 320, src: true });

    const watermark = player.getByTestId('watermark');
    await expectOverlay(watermark, student.email);
    await expectMoves(page, watermark);

    // The controls (pause, mute, speed) leave it in place.
    await player.getByRole('button', { name: t(locale, 'learn.media.pause') }).click();
    await player.getByRole('button', { name: t(locale, 'learn.media.mute') }).click();
    await player.getByLabel(t(locale, 'learn.media.speed')).selectOption('1.5');
    await expectOverlay(watermark, student.email);

    // Fullscreen is requested on the wrapper, so the overlay is inside the fullscreen element.
    await player.getByRole('button', { name: t(locale, 'learn.media.fullscreen') }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.fullscreenElement?.querySelector('[data-testid="watermark"]') !== null,
        ),
      )
      .toBe(true);
    await expectOverlay(watermark, student.email);
    await expectMoves(page, watermark);
    await player.getByRole('button', { name: t(locale, 'learn.media.exitFullscreen') }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

    // --- PDF: the same overlay over the pages.
    await page.goto(`/${locale}/app/courses/${course.id}/lessons/${pdfLesson.id}`);
    const doc = page.getByRole('region', {
      name: fill(t(locale, 'learn.media.document'), { title: pdfLesson.title }),
    });
    await expect(doc.getByTestId('pdf-page')).toHaveCount(2, { timeout: 20_000 });
    const pdfMark = doc.getByTestId('watermark');
    await expectOverlay(pdfMark, student.email);
    await expectMoves(page, pdfMark);
    await doc.getByRole('button', { name: t(locale, 'learn.media.zoomIn') }).click();
    await expectOverlay(pdfMark, student.email);
  });
});
