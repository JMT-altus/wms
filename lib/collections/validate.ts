import { z } from "zod";
import { isRealIsoDate } from "@/lib/leave/workflow";

/**
 * A follow-up as submitted. The author is never part of the input — the server
 * takes it from the session — and neither is any financial figure.
 */
export const FollowUpInput = z
  .object({
    partyName: z.string().trim().min(1, "Choose a party.").max(200),
    nextFollowupDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
      .refine(isRealIsoDate, "Use a valid date.")
      .nullish(),
    note: z.string().trim().max(2000, "Notes are limited to 2,000 characters.").nullish(),
  })
  .strict()
  .refine((v) => Boolean(v.nextFollowupDate) || Boolean(v.note && v.note.length > 0), {
    message: "Enter a next follow-up date or a note.",
    path: ["note"],
  });

export type FollowUpInputT = z.infer<typeof FollowUpInput>;

/** A follow-up date can't be in the past: it is when you will next chase. */
export function followUpDateError(dateIso: string | null | undefined, todayIso: string): string | null {
  if (!dateIso) return null;
  return dateIso < todayIso ? "The next follow-up date can't be in the past." : null;
}
