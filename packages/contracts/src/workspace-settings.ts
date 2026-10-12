import { z } from 'zod';
import { TimezoneSchema } from './auth';

/** A whole number of minutes in `[min, max]`. */
const minutes = (min: number, max: number) => z.number().int().min(min).max(max);
const ratio = z.number().min(0).max(1);

/**
 * The keys of a workspace settings object (PRD §8.2.1), version 1, without the cross-field rule.
 * Ranges: join windows 0–60 min, empty-room grace 1–30 min, late threshold 0–60 min, ratios 0–1,
 * reminder offsets 0–10080 min (one week), at most 5 of them.
 */
const SettingsFields = {
  default_timezone: TimezoneSchema,
  teacher_join_window_min: minutes(0, 60),
  student_join_window_min: minutes(0, 60),
  empty_room_grace_min: minutes(1, 30),
  late_threshold_min: minutes(0, 60),
  present_ratio: ratio,
  partial_ratio: ratio,
  default_sequential_lessons: z.boolean(),
  default_pdf_download: z.boolean(),
  default_reminder_offsets_min: z.array(minutes(0, 10080)).max(5),
};

/**
 * `Workspace.settings`, version 1 (PRD §8.2.1): every key required, unknown keys refused, and
 * `partial_ratio < present_ratio` (issue on `partial_ratio`). `default_timezone` is stored in the
 * runtime's canonical IANA form.
 */
export const WorkspaceSettingsSchema = z
  .object({ v: z.literal(1), ...SettingsFields })
  .strict()
  .superRefine((s, issue) => {
    if (s.partial_ratio >= s.present_ratio) {
      issue.addIssue({
        code: 'custom',
        path: ['partial_ratio'],
        message: 'partial_ratio must be lower than present_ratio',
      });
    }
  });

export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

/**
 * `PATCH /workspaces/{wid}/settings`: any subset of the keys (not `v`), each within its range;
 * unknown keys refused. The server merges it into the stored settings and validates the result
 * against `WorkspaceSettingsSchema` (so `partial_ratio < present_ratio` holds across the merge).
 */
export const WorkspaceSettingsPatchSchema = z.object(SettingsFields).partial().strict();

export type WorkspaceSettingsPatch = z.infer<typeof WorkspaceSettingsPatchSchema>;

/** Settings of a new workspace; `default_timezone` is the owner's timezone at creation. */
export function defaultWorkspaceSettings(ownerTimezone: string): WorkspaceSettings {
  return {
    v: 1,
    default_timezone: ownerTimezone,
    teacher_join_window_min: 15,
    student_join_window_min: 10,
    empty_room_grace_min: 5,
    late_threshold_min: 10,
    present_ratio: 0.75,
    partial_ratio: 0.25,
    default_sequential_lessons: false,
    default_pdf_download: false,
    default_reminder_offsets_min: [1440, 15, 0],
  };
}
