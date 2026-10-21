/**
 * Exact rupee amounts for collection commitments. Pure; no binary floating
 * point anywhere: an amount is a decimal STRING ("31185501328" paise ⇄
 * "311855013.28"), and arithmetic is done in whole paise with BigInt.
 *
 * Range: what the column holds — numeric(14,2), i.e. at most 12 integer digits
 * and 2 decimals (₹0.01 … ₹9,99,99,99,99,999.99). That is a storage limit, not a
 * business rule.
 */

/** Plain decimal rupees: no sign, no grouping, no exponent; at most 12 integer digits and 2 decimals. */
export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;

export const MAX_AMOUNT_TEXT = "999999999999.99";

export type ParsedAmount = { ok: true; text: string; paise: bigint } | { ok: false; error: string };

/**
 * Validate and normalise a typed amount. Accepts only a string (a number has
 * already been through binary floating point). Returns the canonical "x.yy"
 * text that is stored, and the exact paise.
 */
export function parseAmount(input: unknown): ParsedAmount {
  if (typeof input !== "string") return { ok: false, error: "Enter the committed amount." };
  const s = input.trim();
  if (s === "") return { ok: false, error: "Enter the committed amount." };
  const m = AMOUNT_PATTERN.exec(s);
  if (!m) {
    if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: "Use at most 2 decimal places." };
    if (/^\d{13,}(\.\d*)?$/.test(s)) return { ok: false, error: "That amount is too large." };
    return { ok: false, error: "Enter the amount in rupees, for example 125000 or 125000.50." };
  }
  const paise = toPaise(s);
  if (paise <= 0n) return { ok: false, error: "The committed amount must be more than zero." };
  return { ok: true, text: paiseToText(paise), paise };
}

/** Exact paise from decimal text ("125000.5" → 12500050n). Also reads Postgres numeric text. */
export function toPaise(text: string): bigint {
  const [int, frac = ""] = text.trim().split(".");
  return BigInt(int || "0") * 100n + BigInt((frac + "00").slice(0, 2));
}

/** Canonical "x.yy" text from paise. */
export function paiseToText(paise: bigint): string {
  const neg = paise < 0n;
  const a = neg ? -paise : paise;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}

/** Indian digit grouping of a non-negative integer string: 3118550 → "31,18,550". */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/**
 * "₹1,25,000" for whole rupees (the app's usual style) and "₹31,18,55,013.28"
 * when there are paise — never rounded.
 */
export function formatInrExact(amount: string | bigint): string {
  const paise = typeof amount === "bigint" ? amount : toPaise(amount);
  const neg = paise < 0n;
  const a = neg ? -paise : paise;
  const rupees = groupIndian((a / 100n).toString());
  const p = a % 100n;
  return `${neg ? "-" : ""}₹${rupees}${p === 0n ? "" : `.${String(p).padStart(2, "0")}`}`;
}
