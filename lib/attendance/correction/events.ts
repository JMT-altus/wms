import { IMPORT_EVENT, IMPORT_UNDO_EVENT } from "@/lib/attendance/import/batch";

/**
 * Audit event types written when someone changes another employee's recorded
 * attendance. Pure, so the employee-deletion guard and the tests share one list.
 */
export const ATTENDANCE_CORRECTION_EVENT = "attendance_correction";
export const ADMIN_PUNCH_UPSERT_EVENT = "attendance_punch_upsert";
export const ADMIN_PUNCH_EDIT_EVENT = "attendance_punch_edit";
export const ADMIN_PUNCH_DELETE_EVENT = "attendance_punch_delete";

/**
 * History that must survive the deletion of the person who wrote it: every
 * correction, admin edit and bulk import (import undo reads these rows).
 */
export const PROTECTED_ATTENDANCE_EVENTS = [
  ATTENDANCE_CORRECTION_EVENT,
  ADMIN_PUNCH_UPSERT_EVENT,
  ADMIN_PUNCH_EDIT_EVENT,
  ADMIN_PUNCH_DELETE_EVENT,
  IMPORT_EVENT,
  IMPORT_UNDO_EVENT,
] as const;
