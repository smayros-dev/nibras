import type { User, Workspace } from '@nibras/db';
import { as, loginAs } from '../helpers/auth';
import type { TestContext } from '../helpers/app';
import { createCourse, createEnrollment, createLesson, createModule } from '../helpers/factories';

export const meCourses = (path = '') => `/api/v1/me/courses${path}`;
export const meLesson = (lid: string, path = '') => `/api/v1/me/lessons/${lid}${path}`;

/** A signed-in agent for `user`. */
export async function agentOf(ctx: TestContext, user: User) {
  return as(ctx.http, (await loginAs(ctx, user)).cookie);
}

/**
 * A PUBLISHED course of `workspace` with one module of `lessons` TEXT lessons, `student` enrolled
 * (ACTIVE) when given.
 */
export async function textCourse(
  workspace: Pick<Workspace, 'id'>,
  teacher: Pick<User, 'id'>,
  o: { lessons?: number; student?: Pick<User, 'id'>; title?: string } = {},
) {
  const course = await createCourse(workspace, teacher, {
    status: 'PUBLISHED',
    ...(o.title && { title: o.title }),
  });
  const module = await createModule(course);
  const lessons = [];
  for (let i = 0; i < (o.lessons ?? 1); i += 1) {
    lessons.push(await createLesson(module, { type: 'TEXT' }));
  }
  const enrollment = o.student ? await createEnrollment(course, o.student) : undefined;
  return { course, module, lessons, enrollment };
}
