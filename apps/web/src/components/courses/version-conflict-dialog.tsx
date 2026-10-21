'use client';

import { AlertDialog } from '@nibras/ui';
import { useTranslations } from 'next-intl';

/**
 * AC-CRS-03 UI (D-P14, D-P20): a save answered `409 VERSION_CONFLICT` — someone (or another tab)
 * saved the course first. « Recharger » drops the local edits and loads the latest version;
 * « Écraser » re-sends the same edits with `If-Match: "<currentVersion>"`.
 */
export function VersionConflictDialog({
  open,
  currentVersion,
  onOpenChange,
  onReload,
  onOverwrite,
  onCloseAutoFocus,
}: {
  open: boolean;
  currentVersion: number;
  onOpenChange: (open: boolean) => void;
  onReload: () => void;
  onOverwrite: (version: number) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content
        title={t('courses.conflictTitle')}
        description={t('courses.conflictDescription', { version: currentVersion })}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialog.Footer>
          <AlertDialog.Cancel onClick={() => onReload()}>
            {t('courses.conflictReload')}
          </AlertDialog.Cancel>
          <AlertDialog.Action destructive onClick={() => onOverwrite(currentVersion)}>
            {t('courses.conflictOverwrite')}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
