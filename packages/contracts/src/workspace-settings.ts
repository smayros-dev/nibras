/**
 * Workspace settings defaults (PRD §8.2.1), version 1. Task 14 adds `WorkspaceSettingsSchema`
 * (ranges, partial updates) on top of these defaults.
 */
export interface WorkspaceSettings {
  v: 1;
  default_timezone: string;
  teacher_join_window_min: number;
  student_join_window_min: number;
  empty_room_grace_min: number;
  late_threshold_min: number;
  present_ratio: number;
  partial_ratio: number;
  default_sequential_lessons: boolean;
  default_pdf_download: boolean;
  default_reminder_offsets_min: number[];
}

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
