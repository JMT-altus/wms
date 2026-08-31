import { z } from "zod";
import {
  TASK_PRIORITIES,
  APPROVAL_STATUSES,
  TASK_RECURRENCES,
  AUDIENCE_KINDS,
  VISIBILITIES,
} from "@/db/enums";

const uuid = z.string().guid("Must be a UUID");

/**
 * One audience entry on a `restricted` row. `management` carries no id (it
 * means "anyone with a designation flagged is_management"); the other two must.
 */
export const AudienceEntrySchema = z
  .object({
    kind: z.enum(AUDIENCE_KINDS),
    refId: uuid.nullable().optional().default(null),
  })
  .refine(
    (v) => (v.kind === "management" ? v.refId === null : v.refId !== null),
    "Pick a department or a person for this audience entry",
  );

/**
 * Spread into CreateTaskSchema only — the create path. Editing visibility goes
 * through SetVisibilitySchema above, which requires the field, so nothing here
 * can silently re-scope an existing task.
 *
 * Defaults to `internal` (Everyone): a new task on a shared board is shared
 * unless its creator narrows it. This reverses migration 0078's default;
 * 0078's rule still decides who can SEE a task, it is only the starting
 * position of the picker that moved.
 */
export const VisibilityFields = {
  visibility: z.enum(VISIBILITIES).optional().default("internal"),
  audience: z.array(AudienceEntrySchema).max(100).optional().default([]),
};

export const SetVisibilitySchema = z
  .object({
    visibility: z.enum(VISIBILITIES),
    audience: z.array(AudienceEntrySchema).max(100).optional().default([]),
  })
  .refine(
    (v) => v.visibility !== "restricted" || v.audience.length > 0,
    "Pick at least one department, manager group or person to share with",
  );
export type SetVisibilityInput = z.input<typeof SetVisibilitySchema>;
const isoDateToDate = z
  .string()
  .datetime({ message: "Must be an ISO-8601 timestamp" })
  .transform((s) => new Date(s));

/** Tier-3 (2026-05-20) — `doerIds` array enables fanout (one submit, N
 *  tasks). Old callers + tests still pass `doerId` (single); the refine()
 *  rule requires exactly one of the two. `tags` is the new free-form list. */
export const CreateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Client name is required").max(240),
    doerId: uuid.optional(),
    doerIds: z.array(uuid).min(1, "Pick at least one Doer").max(50).optional(),
    initiatorId: uuid,
    priority: z.enum(TASK_PRIORITIES),
    dueAt: isoDateToDate,
    description: z
      .string()
      .trim()
      .max(8000)
      .nullable()
      .optional()
      .default(null),
    subject: z.string().trim().max(120).nullable().optional().default(null),
    notes: z.string().trim().max(8000).nullable().optional().default(null),
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .nullable()
      .optional()
      .default(null),
    // Tier-4 — GCal-style scheduling. All optional; one-off tasks
    // (the common case) leave them null.
    startsAt: isoDateToDate.nullable().optional().default(null),
    endsAt: isoDateToDate.nullable().optional().default(null),
    allDay: z.boolean().optional().default(false),
    recurrence: z.enum(TASK_RECURRENCES).nullable().optional().default(null),
    recurrenceRule: z.string().trim().max(200).nullable().optional().default(null),
    projectNodeId: z.string().uuid().nullable().optional().default(null),
    ...VisibilityFields,
  })
  .refine(
    (v) => Boolean(v.doerId) !== Boolean(v.doerIds && v.doerIds.length > 0),
    "Provide exactly one of doerId or doerIds",
  )
  .refine(
    (v) => v.visibility !== "restricted" || v.audience.length > 0,
    "Pick at least one department, manager group or person to share with",
  )
  .refine(
    (v) =>
      !(v.startsAt && v.endsAt) || v.endsAt.getTime() >= v.startsAt.getTime(),
    "End time must be at or after start time",
  );

export type CreateTaskInput = z.input<typeof CreateTaskSchema>;
export type CreateTaskParsed = z.output<typeof CreateTaskSchema>;

/**
 * Editable subset (per Permissions matrix, spec line 223):
 * title / description / priority / due / notes / subject.
 * Status / doerId / initiatorId are NOT editable via this path —
 * they have dedicated Server Actions (setTaskStatus, reassignDoer).
 */
export const EditTaskFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().max(8000).nullable().optional(),
    subject: z.string().trim().max(120).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueAt: isoDateToDate.optional(),
    notes: z.string().trim().max(8000).nullable().optional(),
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .nullable()
      .optional(),
    // Tier-4 — scheduling fields, all editable in the same patch.
    startsAt: isoDateToDate.nullable().optional(),
    endsAt: isoDateToDate.nullable().optional(),
    allDay: z.boolean().optional(),
    recurrence: z.enum(TASK_RECURRENCES).nullable().optional(),
    recurrenceRule: z.string().trim().max(200).nullable().optional(),
    projectNodeId: z.string().uuid().nullable().optional(),
  })
  .strict() // reject unknown keys
  .refine(
    (obj) => Object.keys(obj).length > 0,
    "At least one field must be provided",
  )
  .refine(
    (v) =>
      !(v.startsAt && v.endsAt) || v.endsAt.getTime() >= v.startsAt.getTime(),
    "End time must be at or after start time",
  );

/** Admin-only — set or clear the verdict on a task. Pair with status edits
 *  if needed; the two columns are independent. */
export const SetApprovalStatusSchema = z.object({
  approvalStatus: z.enum(APPROVAL_STATUSES).nullable(),
  note: z.string().trim().max(2000).optional(),
});
export type SetApprovalStatusInput = z.input<typeof SetApprovalStatusSchema>;
export type SetApprovalStatusParsed = z.output<typeof SetApprovalStatusSchema>;

/** Admin-only — record a revised target date without losing the original
 *  due_at. Pass null to clear. */
export const SetRevisedTargetDateSchema = z.object({
  revisedTargetDate: isoDateToDate.nullable(),
});
export type SetRevisedTargetDateInput = z.input<typeof SetRevisedTargetDateSchema>;
export type SetRevisedTargetDateParsed = z.output<typeof SetRevisedTargetDateSchema>;

export type EditTaskFieldsInput = z.input<typeof EditTaskFieldsSchema>;
export type EditTaskFieldsParsed = z.output<typeof EditTaskFieldsSchema>;

const optionalNote = z.string().trim().max(2000).optional();
const requiredNote = z.string().trim().min(1, "Note required").max(2000);

export const ApproveSchema = z.object({
  decision: z.enum(["approved", "not_approved"]),
  note: optionalNote,
});
export type ApproveInput = z.input<typeof ApproveSchema>;
export type ApproveParsed = z.output<typeof ApproveSchema>;

export const ReassignSchema = z.object({
  newDoerId: uuid,
  resetStatus: z.boolean().optional().default(false),
});
export type ReassignInput = z.input<typeof ReassignSchema>;
export type ReassignParsed = z.output<typeof ReassignSchema>;

export const TransferExternalSchema = z.object({
  note: requiredNote,
});
export type TransferExternalInput = z.input<typeof TransferExternalSchema>;
export type TransferExternalParsed = z.output<typeof TransferExternalSchema>;

export const CancelSchema = z.object({
  note: optionalNote,
});
export type CancelInput = z.input<typeof CancelSchema>;
export type CancelParsed = z.output<typeof CancelSchema>;

export const CommentSchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(4000),
});
export type CommentInput = z.input<typeof CommentSchema>;
export type CommentParsed = z.output<typeof CommentSchema>;
