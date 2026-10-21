import { useTranslations } from 'next-intl';

/** A labelled course progress bar (`role="progressbar"`, 0–100) with its percent as text. */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const t = useTranslations();
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const text = t('enrollments.percent', { percent: value });
  return (
    <span className="flex min-w-32 items-center gap-2">
      <span
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={text}
        className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle"
      >
        <span className="block h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </span>
      <span className="shrink-0 text-xs text-fg-muted tabular-nums" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
