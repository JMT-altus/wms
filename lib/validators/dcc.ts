import { z } from "zod";
import { DCC_STATUSES } from "@/lib/dcc/util";

const uuid = z.string().guid("Must be a UUID");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a yyyy-mm-dd date");

/** A fill number. Bounded so a fat-finger can't write 1e20 into numeric(14,2). */
const fillValue = z.coerce
  .number()
  .finite()
  .min(-99_999_999_999)
  .max(99_999_999_999)
  .nullable();

export const SetDccEntrySchema = z.object({
  itemId: uuid,
  date: ymd,
  status: z.enum(DCC_STATUSES).nullable().optional().default(null),
  value: fillValue.optional().default(null),
  note: z.string().trim().max(2000).nullable().optional().default(null),
  subjectId: uuid.nullable().optional().default(null),
  /**
   * Skip `revalidatePath`. The fill gate sets this on every keystroke: a
   * mid-fill re-render would re-run the gate check, and a transient hiccup
   * there would dismiss the wall before the day was actually filled.
   */
  silent: z.boolean().optional().default(false),
});
export type SetDccEntryInput = z.input<typeof SetDccEntrySchema>;

export const SetParticipantEntriesSchema = z.object({
  itemId: uuid,
  date: ymd,
  status: z.enum(DCC_STATUSES).nullable(),
});
export type SetParticipantEntriesInput = z.input<typeof SetParticipantEntriesSchema>;

/** Shared editable fields of a KPI definition. */
const itemFields = {
  section: z.string().trim().max(120).nullable().optional().default(null),
  code: z.string().trim().max(24).nullable().optional().default(null),
  title: z.string().trim().min(1, "Title is required").max(300),
  /** Free text — parseFrequency() is the authority on what it means. */
  frequency: z.string().trim().max(200).nullable().optional().default(null),
  targetNumber: z.coerce.number().finite().min(0).max(99_999_999_999).nullable().optional().default(null),
  unit: z.string().trim().max(40).nullable().optional().default(null),
  clientId: uuid.nullable().optional().default(null),
  isParticipantList: z.boolean().optional().default(false),
};

export const CreateDccItemSchema = z.object({
  ownerEmployeeId: uuid,
  ...itemFields,
});
export type CreateDccItemInput = z.input<typeof CreateDccItemSchema>;

export const UpdateDccItemSchema = z.object({
  id: uuid,
  ...itemFields,
});
export type UpdateDccItemInput = z.input<typeof UpdateDccItemSchema>;

export const DeleteDccItemSchema = z.object({ id: uuid });

export const AddParticipantSchema = z.object({
  itemId: uuid,
  name: z.string().trim().min(1, "Name is required").max(160),
  kind: z.string().trim().max(60).nullable().optional().default(null),
});
export type AddParticipantInput = z.input<typeof AddParticipantSchema>;

export const RemoveParticipantSchema = z.object({ itemId: uuid, subjectId: uuid });

export const RenameParticipantSchema = z.object({
  subjectId: uuid,
  name: z.string().trim().min(1, "Name is required").max(160),
  kind: z.string().trim().max(60).nullable().optional().default(null),
});

export const CreateDccClientSchema = z.object({
  ownerEmployeeId: uuid,
  section: z.string().trim().min(1, "Section is required").max(120),
  name: z.string().trim().min(1, "Name is required").max(160),
});
export type CreateDccClientInput = z.input<typeof CreateDccClientSchema>;

export const UpdateDccClientSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1, "Name is required").max(160),
  archived: z.boolean().optional(),
});

export const DCC_REVIEW_STATUSES = ["approved", "needs_rework"] as const;

export const SetDccReviewSchema = z.object({
  ownerEmployeeId: uuid,
  date: ymd,
  status: z.enum(DCC_REVIEW_STATUSES).nullable().optional().default(null),
  note: z.string().trim().max(2000).nullable().optional().default(null),
  silent: z.boolean().optional().default(false),
});
export type SetDccReviewInput = z.input<typeof SetDccReviewSchema>;

export const DccDayDetailSchema = z.object({ ownerId: uuid, date: ymd });
export const ApproveAllDccSchema = z.object({ date: ymd });
export const SummarizeDccDaySchema = z.object({ ownerId: uuid, date: ymd });
