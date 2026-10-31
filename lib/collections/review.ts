import { z } from "zod";
import { AMOUNT_PATTERN, paiseToText, toPaise, type ParsedAmount } from "./money";

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

/* ── the confirmed amount ─────────────────────────────────────────────────── */

/**
 * The confirmed AMOUNT (migration 0123) is a separate business value from the
 * Yes/No answer: what the person confirms the collection amount to be, in
 * rupees, exact to the paise. Entering it does not answer the Yes/No question
 * and verifies nothing about the approved source's figure.
 */
export const CONFIRMED_AMOUNT_PLACEHOLDER = "Enter confirmed amount";
export const CONFIRMED_AMOUNT_REQUIRED = "Enter the confirmed amount.";
export const CONFIRMED_AMOUNT_MAX_CHARS = 40;

/**
 * A confirmed amount as a person types it — "25450.50", "₹25,450.50" or
 * "25,450.50" — to the canonical "x.yy" text that is stored and the exact
 * paise. The rupee sign, Indian or plain digit grouping and spaces are
 * allowed and removed; nothing else is guessed. Only a string is accepted (a
 * number has already been through binary floating point). Rejects a sign,
 * zero, more than 2 decimals, and anything the column can't hold
 * (numeric(14,2): at most 12 integer digits).
 */
export function parseConfirmedAmount(input: unknown): ParsedAmount {
  if (typeof input !== "string") return { ok: false, error: CONFIRMED_AMOUNT_REQUIRED };
  const raw = input.trim();
  if (raw === "") return { ok: false, error: CONFIRMED_AMOUNT_REQUIRED };
  if (raw.length > CONFIRMED_AMOUNT_MAX_CHARS) return { ok: false, error: "That amount is too long." };
  if (/^[-−(]|-/.test(raw)) return { ok: false, error: "The confirmed amount can't be negative." };
  // Digit grouping, Indian (31,18,55,013.28) or plain (1,234,567.00), is allowed and stripped; a stray comma is not.
  const s = raw.replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/\s+/g, "");
  if (/,/.test(s) && !/^(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})*,\d{3})(\.\d+)?$/.test(s)) return { ok: false, error: "Enter the amount in rupees, for example 25450 or 25,450.50." };
  const plain = s.replace(/,/g, "");
  const m = AMOUNT_PATTERN.exec(plain);
  if (!m) {
    if (/^\d+\.\d{3,}$/.test(plain)) return { ok: false, error: "Use at most 2 decimal places (paise)." };
    if (/^\d{13,}(\.\d*)?$/.test(plain)) return { ok: false, error: "That amount is too large." };
    if (/^0\d/.test(plain)) return { ok: false, error: "Enter the amount in rupees, for example 25450 or 25,450.50." };
    return { ok: false, error: "Enter the amount in rupees, for example 25450 or 25,450.50." };
  }
  const paise = toPaise(plain);
  if (paise <= 0n) return { ok: false, error: "The confirmed amount must be more than zero." };
  return { ok: true, text: paiseToText(paise), paise };
}

/** Entering the confirmed amount: which Collection Master company, and the amount as typed. The actor comes from the session. */
export const ConfirmedAmountInput = z
  .object({
    companyId: z.string().uuid("Choose a company."),
    amount: z.string({ message: CONFIRMED_AMOUNT_REQUIRED }).max(CONFIRMED_AMOUNT_MAX_CHARS, "That amount is too long."),
  })
  .strict();

/** Longest Reason for Escalation accepted (characters, after trimming). The database CHECK (0118) uses the same bound. */
export const ESCALATION_REASON_MAX = 1000;
export const ESCALATION_REASON_REQUIRED = "Enter a reason for escalation.";
export const ESCALATION_REASON_TOO_LONG = `The reason can be at most ${ESCALATION_REASON_MAX.toLocaleString("en-IN")} characters.`;

/**
 * The Reason for Escalation: trimmed, required, at most ESCALATION_REASON_MAX
 * characters. Shared by the dialog (to tell the user early) and the server action
 * (which is what decides — a request that skips the dialog is checked the same way).
 */
export const EscalationReason = z
  .string({ message: ESCALATION_REASON_REQUIRED })
  .trim()
  .min(1, ESCALATION_REASON_REQUIRED)
  .max(ESCALATION_REASON_MAX, ESCALATION_REASON_TOO_LONG);

/** Escalating a company for review, with the reason. The actor and the time come from the server. */
export const EscalationInput = z.object({ companyId: z.string().uuid("Choose a company."), reason: EscalationReason }).strict();

/** Closing one open escalation (owner only). */
export const CloseEscalationInput = z.object({ escalationId: z.string().uuid("Choose an escalation.") }).strict();

export type EscalationStatus = "open" | "closed";
