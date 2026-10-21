import { z } from "zod";

/**
 * Collection Amount Confirmation and escalation for review —
 * values and input rules. Pure; shared by the Tracker, the owner's page, the
 * server actions and the tests.
 *
 * Confirmation answers one question: is the outstanding amount the APPROVED
 * transaction source reports for this company correct? So it can only be given
 * when the source actually supplies that amount. "Not set" is the absence of
 * any answer — never a default "Yes".
 */

export const CONFIRMATION_VALUES = ["yes", "no"] as const;
export type ConfirmationValue = (typeof CONFIRMATION_VALUES)[number];

export const CONFIRMATION_LABELS: Record<ConfirmationValue, string> = { yes: "Yes", no: "No" };

/** What the screens show for a company's confirmation state. */
export function confirmationLabel(value: ConfirmationValue | null | undefined): string {
  return value ? CONFIRMATION_LABELS[value] : "Not set";
}

/**
 * Whether there is an amount to confirm: the company's outstanding amount as the
 * approved transaction source supplies it. Null (no approved source, or the
 * source gave none) means confirmation is unavailable — nothing is invented.
 */
export const confirmationAvailable = (outstanding: number | null | undefined): boolean =>
  typeof outstanding === "number" && Number.isFinite(outstanding);

export const CONFIRMATION_UNAVAILABLE =
  "There is no outstanding amount from an approved transaction source to confirm for this company.";

/** Setting the confirmation: which Collection Master company, and Yes or No. The actor comes from the session. */
export const ConfirmationInput = z
  .object({
    companyId: z.string().uuid("Choose a company."),
    value: z.enum(CONFIRMATION_VALUES, { message: "Choose Yes or No." }),
  })
  .strict();

/** Escalating a company for review. The actor comes from the session. */
export const EscalationInput = z.object({ companyId: z.string().uuid("Choose a company.") }).strict();

/** Closing one open escalation (owner only). */
export const CloseEscalationInput = z.object({ escalationId: z.string().uuid("Choose an escalation.") }).strict();

export type EscalationStatus = "open" | "closed";
