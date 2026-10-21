import type {
  MyCourse,
  MyCourseDetail,
  MyLesson,
  MyLessonDetail,
  MyModule,
} from '@nibras/contracts';

/** Test builders for the student's learn views (`/me/courses`, `/me/lessons`). */
export function myCourse(
  id: string,
  extra: Partial<MyCourse['course']> = {},
  rest: Partial<MyCourse> = {},
): MyCourse {
  return {
    course: {
      id,
      title: `Cours ${id}`,
      coverUrl: null,
      level: null,
      language: 'fr',
      estimatedMinutes: null,
      status: 'PUBLISHED',
      workspace: { id: 'w1', name: 'Lycée Ibn Khaldoun' },
      teacher: { firstName: 'Mohamed', lastName: 'Ben Ali' },
      ...extra,
    },
    progressPercent: 0,
    completedAt: null,
    lastActivityAt: null,
    ...rest,
  };
}

export function myLesson(id: string, extra: Partial<MyLesson> = {}): MyLesson {
  return {
    id,
    title: `Leçon ${id}`,
    description: null,
    type: 'TEXT',
    position: 1,
    isRequired: true,
    estimatedMinutes: 10,
    allowDownload: false,
    media: null,
    progress: { status: 'NOT_STARTED', completedAt: null },
    locked: false,
    lock: null,
    ...extra,
  };
}

export function myModule(id: string, lessons: MyLesson[], extra: Partial<MyModule> = {}): MyModule {
  return {
    id,
    title: `Module ${id}`,
    description: null,
    position: 1,
    isOptional: false,
    unlockRule: { type: 'NONE' },
    percent: 0,
    locked: false,
    lock: null,
    lessons,
    ...extra,
  };
}

export function myCourseDetail(
  modules: MyModule[],
  extra: Partial<MyCourseDetail> = {},
): MyCourseDetail {
  return {
    course: {
      ...myCourse('c1').course,
      title: 'Algèbre 1',
      description: null,
      sequentialLessons: false,
    },
    progressPercent: 40,
    completedAt: null,
    modules,
    next: null,
    ...extra,
  };
}

export function myLessonDetail(extra: Partial<MyLessonDetail> = {}): MyLessonDetail {
  return {
    lesson: myLesson('l1', { title: 'Les fractions' }),
    course: { id: 'c1', title: 'Algèbre 1' },
    module: { id: 'm1', title: 'Bases' },
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour' }] }],
    },
    images: {},
    playback: null,
    previous: null,
    next: { lessonId: 'l2' },
    ...extra,
  };
}
