import { appUrl, expect, t, test, toast, uiLogin } from './helpers';
import { fill, seedTeacher } from './helpers/invitations';
import {
  courseVersion,
  createCourse,
  publishCourse,
  enroll,
  seedClassroom,
  type Classroom,
} from './helpers/media';

/**
 * SP3 teacher journeys (plan T17): build and publish a course then assign it (AC-CRS-01,
 * AC-ENR-01 UI), the optimistic-lock conflict dialog across two tabs (AC-CRS-03 UI), keyboard
 * reorder (AC-CRS-04 UI), and the deletion rules of a published course (AC-CRS-05 UI).
 */

test.describe('teacher courses', () => {
  test('create → publish refused with its blockers → module + text lesson → publish → assign → the student sees it in « Mes cours » (AC-CRS-01, AC-ENR-01 UI)', async ({
    page,
    browser,
    uiLocale: locale,
  }) => {
    test.setTimeout(150_000);
    const room: Classroom = await seedClassroom();
    try {
      const { teacher, student } = room;
      await uiLogin(page, locale, teacher.user);
      await page.goto(`/${locale}/app/w/${teacher.wid}/courses`);
      await page
        .getByRole('button', { name: t(locale, 'courses.create') })
        .first()
        .click();
      const create = page.getByRole('dialog', { name: t(locale, 'courses.createTitle') });
      await create.getByLabel(t(locale, 'courses.fieldTitle')).fill('Mathématiques 1');
      await create.getByRole('button', { name: t(locale, 'courses.createSubmit') }).click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/app/w/${teacher.wid}/courses/[0-9a-f-]{36}$`),
      );

      // DRAFT without a module: publishing is refused and the blockers are listed.
      const publish = page.getByRole('button', { name: t(locale, 'courses.publish') });
      await expect(publish).toBeDisabled();
      await expect(page.getByText(t(locale, 'courses.blocker_NO_MODULE'))).toBeVisible();

      await page
        .getByRole('button', { name: t(locale, 'structure.addModule') })
        .first()
        .click();
      const moduleDialog = page.getByRole('dialog', {
        name: t(locale, 'structure.moduleCreateTitle'),
      });
      await moduleDialog
        .getByRole('textbox', { name: t(locale, 'structure.fieldTitle'), exact: true })
        .fill('Les nombres');
      await moduleDialog.getByRole('button', { name: t(locale, 'structure.create') }).click();
      await expect(moduleDialog).toBeHidden();

      await page.getByRole('button', { name: t(locale, 'structure.addLesson') }).click();
      const lessonDialog = page.getByRole('dialog', {
        name: t(locale, 'structure.lessonCreateTitle'),
      });
      await lessonDialog.getByRole('radio', { name: t(locale, 'structure.type_TEXT') }).check();
      await lessonDialog
        .getByRole('textbox', { name: t(locale, 'structure.fieldTitle'), exact: true })
        .fill('Compter');
      const content = lessonDialog.getByRole('textbox', {
        name: t(locale, 'structure.fieldContent'),
      });
      await content.click();
      await page.keyboard.type('Un, deux, trois.');
      await lessonDialog.getByRole('button', { name: t(locale, 'structure.create') }).click();
      await expect(lessonDialog).toBeHidden();

      await expect(publish).toBeEnabled();
      await publish.click();
      await expect(toast(page, locale, t(locale, 'courses.published'))).toBeVisible();
      await expect(page.getByText(t(locale, 'courses.status_PUBLISHED')).first()).toBeVisible();

      // Assign the student from the course's students tab.
      await page
        .getByRole('tablist', { name: t(locale, 'courses.sections') })
        .getByRole('tab', { name: t(locale, 'courses.tabStudents') })
        .click();
      await expect(page).toHaveURL(/\/students$/);
      await page
        .getByRole('button', { name: t(locale, 'enrollments.assign') })
        .first()
        .click();
      const assign = page.getByRole('dialog', {
        name: t(locale, 'enrollments.assignTitle').replace('{title}', 'Mathématiques 1'),
      });
      await assign.getByRole('checkbox', { name: `${student.firstName} Ben Ali` }).check();
      await assign.getByRole('button', { name: t(locale, 'enrollments.assignSubmit') }).click();
      await expect(assign).toBeHidden();
      await expect(page.getByRole('table').getByText(`${student.firstName} Ben Ali`)).toBeVisible();

      // The student's « Mes cours ».
      const studentContext = await browser.newContext();
      try {
        const studentPage = await studentContext.newPage();
        await uiLogin(studentPage, locale, student);
        await studentPage.goto(`/${locale}/app/courses`);
        await studentPage
          .getByRole('link', { name: /Mathématiques 1/ })
          .first()
          .click();
        await expect(studentPage.getByRole('link', { name: /Compter/ })).toBeVisible();
      } finally {
        await studentContext.close();
      }
    } finally {
      await room.dispose();
    }
  });

  test('two tabs edit the same course: the second save shows the conflict dialog; « Écraser » wins (AC-CRS-03 UI)', async ({
    page,
    context,
    uiLocale: locale,
  }) => {
    test.setTimeout(120_000);
    const teacher = await seedTeacher();
    try {
      const course = await createCourse(teacher.ctx, teacher.wid, { title: 'Cours partagé' });
      await uiLogin(page, locale, teacher.user);
      const settings = `/${locale}/app/w/${teacher.wid}/courses/${course.id}/settings`;
      const other = await context.newPage();
      await page.goto(settings);
      await other.goto(settings);

      const title = (p: typeof page) =>
        p.getByRole('textbox', { name: t(locale, 'courses.fieldTitle'), exact: true });
      // Both tabs hold version 1; each acts while in front (a background tab does not paint).
      await page.bringToFront();
      await title(page).fill('Version de l’onglet 1');
      await page.getByRole('button', { name: t(locale, 'courses.save') }).click();
      await expect(toast(page, locale, t(locale, 'courses.saved'))).toBeVisible();

      await other.bringToFront();
      await title(other).fill('Version de l’onglet 2');
      await other.getByRole('button', { name: t(locale, 'courses.save') }).click();
      const conflict = other.getByRole('alertdialog', { name: t(locale, 'courses.conflictTitle') });
      await expect(conflict).toBeVisible();
      await conflict.getByRole('button', { name: t(locale, 'courses.conflictOverwrite') }).click();
      await expect(toast(other, locale, t(locale, 'courses.saved'))).toBeVisible();

      await page.bringToFront();
      await page.reload();
      await expect(title(page)).toHaveValue('Version de l’onglet 2');
      expect(await courseVersion(teacher.ctx, teacher.wid, course.id)).toBe(3);
    } finally {
      await teacher.ctx.dispose();
    }
  });

  test('keyboard reorder of 5 lessons persists 1..5 after a reload (AC-CRS-04 UI)', async ({
    page,
    uiLocale: locale,
  }) => {
    test.setTimeout(120_000);
    const teacher = await seedTeacher();
    try {
      const titles = ['Leçon A', 'Leçon B', 'Leçon C', 'Leçon D', 'Leçon E'];
      const course = await createCourse(teacher.ctx, teacher.wid, {
        title: 'Cours à réordonner',
        modules: [{ title: 'Module 1', lessons: titles.map((title) => ({ type: 'TEXT', title })) }],
      });
      await uiLogin(page, locale, teacher.user);
      await page.goto(`/${locale}/app/w/${teacher.wid}/courses/${course.id}`);
      const list = page.getByRole('list', {
        name: t(locale, 'structure.lessonsList').replace('{title}', 'Module 1'),
      });
      await expect(list.getByRole('listitem')).toHaveCount(5);

      // Pick « Leçon A » up with Space, move it down four times, drop it with Space — each key
      // after dnd-kit's live announcement of the previous one (it measures between moves).
      const announce = (key: string, position: number) =>
        page
          .getByRole('status')
          .getByText(
            fill(t(locale, key), { title: 'Leçon A', position: String(position), total: '5' }),
          );
      await list
        .getByRole('button', {
          name: t(locale, 'structure.dragHandle').replace('{title}', 'Leçon A'),
        })
        .focus();
      await page.keyboard.press('Space');
      // dnd-kit announces the pick-up, then at once the position it is over.
      await expect(announce('structure.dndOver', 1)).toBeAttached();
      for (let position = 2; position <= 5; position++) {
        await page.keyboard.press('ArrowDown');
        await expect(announce('structure.dndOver', position)).toBeAttached();
      }
      await page.keyboard.press('Space');
      await expect(toast(page, locale, t(locale, 'structure.reordered'))).toBeVisible();

      const expected = ['Leçon B', 'Leçon C', 'Leçon D', 'Leçon E', 'Leçon A'];
      await page.reload();
      await expect(list.getByRole('listitem')).toHaveText(
        expected.map((title) => new RegExp(title)),
      );
      const res = await teacher.ctx.get(
        `/api/v1/workspaces/${teacher.wid}/courses/${course.id}/structure`,
      );
      const structure = (await res.json()) as {
        modules: { lessons: { title: string; position: number }[] }[];
      };
      expect(structure.modules[0]!.lessons.map((l) => [l.position, l.title])).toEqual(
        expected.map((title, i) => [i + 1, title]),
      );
    } finally {
      await teacher.ctx.dispose();
    }
  });

  test('a published course offers « Archiver puis supprimer »; with an active enrollment the deletion is refused with a hint (AC-CRS-05 UI)', async ({
    page,
    uiLocale: locale,
  }) => {
    test.setTimeout(120_000);
    const room = await seedClassroom();
    try {
      const { teacher, student } = room;
      const course = await createCourse(teacher.ctx, teacher.wid, {
        title: 'Cours à supprimer',
        modules: [{ title: 'Module 1', lessons: [{ type: 'TEXT', title: 'Intro' }] }],
      });
      await publishCourse(teacher.ctx, teacher.wid, course.id);
      await enroll(teacher.ctx, teacher.wid, course.id, [student.userId]);

      await uiLogin(page, locale, teacher.user);
      await page.goto(`/${locale}/app/w/${teacher.wid}/courses/${course.id}`);
      await page.getByRole('button', { name: t(locale, 'courses.actions') }).click();
      await expect(
        page.getByRole('menuitem', { name: t(locale, 'courses.delete'), exact: true }),
      ).toHaveCount(0);
      await page.getByRole('menuitem', { name: t(locale, 'courses.archiveDelete') }).click();
      const confirm = page.getByRole('alertdialog', {
        name: t(locale, 'courses.archiveDeleteTitle').replace('{title}', course.title),
      });
      await confirm.getByRole('button', { name: t(locale, 'courses.archiveDelete') }).click();
      await expect(
        toast(page, locale, t(locale, 'errors.COURSE_HAS_ACTIVE_ENROLLMENTS')),
      ).toBeVisible();
      // Archived, not deleted: the page stays and the course is still listed.
      await expect(page).toHaveURL(appUrl(`/${locale}/app/w/${teacher.wid}/courses/${course.id}`));
      await expect(page.getByText(t(locale, 'courses.status_ARCHIVED')).first()).toBeVisible();
    } finally {
      await room.dispose();
    }
  });
});
