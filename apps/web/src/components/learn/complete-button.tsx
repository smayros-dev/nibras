'use client';

import type { ProgressActionResult } from '@nibras/contracts';
import { Button, useSubmit, useToast } from '@nibras/ui';
import { CircleCheck, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage } from '../../lib/api-error';

type ProgressPath =
  '/me/lessons/{lid}/opened' | '/me/lessons/{lid}/complete' | '/me/lessons/{lid}/uncomplete';

async function post(path: ProgressPath, lid: string) {
  return asApiResult<ProgressActionResult>(await api.POST(path, { params: { path: { lid } } }));
}

/**
 * « Marquer comme terminé » / « Annuler terminé » (PRD §8.6, D-P8 manual completion). With
 * `openOnMount` it first posts `opened` (text and PDF lessons: the visit starts the lesson; a PDF
 * cannot be completed before). Every answer goes to `onResult` (the lesson status and the course
 * percent); a refusal (`409 LESSON_NOT_OPENED`, `423` suspended workspace, …) is a toast.
 */
export function CompleteButton({
  lessonId,
  completed,
  disabled,
  openOnMount,
  onResult,
}: {
  lessonId: string;
  completed: boolean;
  disabled: boolean;
  openOnMount: boolean;
  onResult: (result: ProgressActionResult) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    if (!openOnMount) return;
    let live = true;
    post('/me/lessons/{lid}/opened', lessonId)
      .then(({ data }) => {
        if (live && data) onResultRef.current(data);
      })
      // Best effort: the lesson stays readable; completing it reports any real problem.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [lessonId, openOnMount]);

  const toggle = useSubmit(async () => {
    try {
      const { data, error } = await post(
        completed ? '/me/lessons/{lid}/uncomplete' : '/me/lessons/{lid}/complete',
        lessonId,
      );
      if (data) onResultRef.current(data);
      else toast({ title: apiErrorMessage(t, error), variant: 'danger' });
    } catch {
      toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
    }
  });

  return (
    <Button
      variant={completed ? 'secondary' : 'primary'}
      loading={toggle.busy}
      disabled={disabled}
      iconStart={completed ? <Undo2 aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
      onClick={() => void toggle.submit()}
    >
      {completed ? t('learn.unmarkComplete') : t('learn.markComplete')}
    </Button>
  );
}
