import { cleanText, nameKey } from "../master/normalize";
import { toPaise } from "../money";

/**
 * What a Tally customer-summary upload would do. Pure: no database, no clock.
 * Run twice — for the read-only preview and again, inside the write
 * transaction, at confirmation — so what is written is what was checked.
 *
 * Rules:
 *   - A row is matched to an EXISTING Collection Master company by `nameKey`
 *     (case, spacing and punctuation ignored). An unmatched name is reported and
 *     skipped; no company is ever created.
 *   - Debit and Credit are taken exactly as the file has them. A negative value
 *     is kept and flagged, never re-signed. Non-numeric text, more than two
 *     decimals, or both cells blank → the row is rejected.
 *   - The same company twice with identical figures: the first row counts, the
 *     repeat is flagged and ignored. With different figures: every row of that
 *     company is rejected, so no guess is made about which one is right.
 *   - Amounts are summed in whole paise so totals are exact.
 *   - The rows must add up to the file's own Grand Total (see verifyTotals).
 *     No Grand Total, an unreadable one, or rows that don't add up means the
 *     upload is not importable: the preview still shows everything, but the
 *     write refuses.
 */

export type BalanceRowStatus = "matched" | "unmatched" | "duplicate" | "conflict" | "rejected";

export interface BalanceInputRow {
  rowNo: number;
  name: string;
  debit: string;
  credit: string;
}

export interface BalanceCompany {
  id: string;
  companyName: string;
}

export interface BalanceMessage {
  level: "error" | "warning" | "info";
  text: string;
}

export interface PlannedBalanceRow {
  rowNo: number;
  name: string;
  nameKey: string;
  status: BalanceRowStatus;
  /** Rupees, as written in the file; null = blank (or unreadable). */
  debit: number | null;
  credit: number | null;
  debitPaise: number | null;
  creditPaise: number | null;
  companyId: string | null;
  companyName: string | null;
  negative: boolean;
  messages: BalanceMessage[];
}

export interface PaisePair {
  debit: number;
  credit: number;
}

/**
 * Whether the rows add up to the file's own Grand Total.
 *
 * Tolerance: each Debit / Credit is a two-decimal figure that may itself have
 * been rounded by up to half a paisa when Tally printed it, so N rows can differ
 * from an exactly-computed total by up to N/2 paise, plus half a paisa for the
 * total's own rounding. The allowed gap is therefore ceil((N + 1) / 2) paise per
 * column (₹1.34 for 266 rows) — enough for rounding, far too small to hide a
 * missing or changed customer.
 */
export interface TotalsVerification {
  status: "ok" | "missing" | "unreadable" | "mismatch";
  tolerancePaise: number;
  /** source − rows, in paise; null without a readable source total. */
  differencePaise: { debit: number; credit: number } | null;
  /** Why the upload can't be imported; null when status is "ok". */
  message: string | null;
}

export const totalsTolerancePaise = (rowCount: number): number => Math.ceil((rowCount + 1) / 2);

export interface BalanceSummary {
  rows: number;
  matched: number;
  unmatched: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  /** Matched rows carrying a negative Debit or Credit. */
  negatives: number;
  /** Rupees. `source` is the file's own Grand Total (null when it has none or it isn't a number). */
  totals: {
    source: { debit: number; credit: number } | null;
    /** Every row that read cleanly, as the file has them (repeats included). */
    sheetRows: { debit: number; credit: number };
    imported: { debit: number; credit: number };
    unmatched: { debit: number; credit: number };
    ignoredDuplicates: { debit: number; credit: number };
    conflicting: { debit: number; credit: number };
    /** source − sheetRows; null without a source total. Non-zero means the rows don't add up to the file's own total. */
    difference: { debit: number; credit: number } | null;
  };
  verification: TotalsVerification;
  /** Exactly what the confirm step must see again. */
  fingerprint: { matched: number; debitPaise: number; creditPaise: number };
}

export interface BalancePlan {
  rows: PlannedBalanceRow[];
  summary: BalanceSummary;
  /** Rows that will be written, in file order. */
  toWrite: PlannedBalanceRow[];
}

/** numeric(14,2): at most 12 integer digits (below 10^12 rupees). */
const MAX_INTEGER_DIGITS = 12;
const MONEY_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/;

export type MoneyParse = { kind: "blank" } | { kind: "ok"; paise: number } | { kind: "error"; reason: string };

/**
 * A Debit / Credit cell as text → whole paise. Strict: nothing is guessed,
 * rounded or re-signed. Exact: the digits are read as text (toPaise, BigInt),
 * never through binary floating point, so ₹31,18,55,013.28 is read as
 * 31185501328 paise. Decimals beyond the second must be zeros ("1.230" is
 * ₹1.23; "1.005" is refused). The result is at most 10^14 paise, well inside
 * the range where a JS number is an exact integer.
 */
export function parseMoney(text: string): MoneyParse {
  const s = text.trim();
  if (s === "") return { kind: "blank" };
  const m = MONEY_TEXT.exec(s.replace(/,/g, ""));
  if (!m) return { kind: "error", reason: `"${s.slice(0, 40)}" is not a number` };
  const negative = m[1] === "-";
  const frac = m[3] ?? "";
  if (/[1-9]/.test(frac.slice(2))) return { kind: "error", reason: `"${s.slice(0, 40)}" has more than two decimal places` };
  const digits = m[2]!.replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_INTEGER_DIGITS) return { kind: "error", reason: `"${s.slice(0, 40)}" is too large` };
  const paise = Number(toPaise(`${digits}.${frac.slice(0, 2)}`));
  return { kind: "ok", paise: paise === 0 ? 0 : negative ? -paise : paise };
}

const rupees = (p: number) => p / 100;
const pair = (): PaisePair => ({ debit: 0, credit: 0 });
const out = (p: PaisePair) => ({ debit: rupees(p.debit), credit: rupees(p.credit) });

export function buildBalancePlan(
  input: BalanceInputRow[],
  existing: ReadonlyMap<string, BalanceCompany>,
  sourceTotal: { debit: string; credit: string } | null,
): BalancePlan {
  const planned: PlannedBalanceRow[] = input.map((r) => {
    const name = cleanText(r.name);
    const d = parseMoney(r.debit);
    const c = parseMoney(r.credit);
    const messages: BalanceMessage[] = [];
    const key = nameKey(name);
    let status: BalanceRowStatus = "matched"; // provisional; settled below
    if (name === "") {
      status = "rejected";
      messages.push({ level: "error", text: "No company name (Particulars) on this row." });
    } else if (key === "") {
      status = "rejected";
      messages.push({ level: "error", text: "The name has no letters or digits." });
    }
    if (d.kind === "error") {
      status = "rejected";
      messages.push({ level: "error", text: `Debit: ${d.reason}.` });
    }
    if (c.kind === "error") {
      status = "rejected";
      messages.push({ level: "error", text: `Credit: ${c.reason}.` });
    }
    if (d.kind === "blank" && c.kind === "blank") {
      status = "rejected";
      messages.push({ level: "error", text: "Both Debit and Credit are blank." });
    }
    const debitPaise = d.kind === "ok" ? d.paise : null;
    const creditPaise = c.kind === "ok" ? c.paise : null;
    const negative = (debitPaise ?? 0) < 0 || (creditPaise ?? 0) < 0;
    if (negative && status !== "rejected") messages.push({ level: "warning", text: "Negative value kept exactly as in the file." });
    return {
      rowNo: r.rowNo,
      name,
      nameKey: key,
      status,
      debit: debitPaise === null ? null : rupees(debitPaise),
      credit: creditPaise === null ? null : rupees(creditPaise),
      debitPaise,
      creditPaise,
      companyId: null,
      companyName: null,
      negative,
      messages,
    };
  });

  // Duplicates: only rows that read cleanly take part.
  const groups = new Map<string, PlannedBalanceRow[]>();
  for (const r of planned) {
    if (r.status === "rejected") continue;
    groups.set(r.nameKey, [...(groups.get(r.nameKey) ?? []), r]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const [first, ...rest] = g as [PlannedBalanceRow, ...PlannedBalanceRow[]];
    const same = rest.every((r) => r.debitPaise === first.debitPaise && r.creditPaise === first.creditPaise);
    const rowsList = g.map((r) => r.rowNo).join(", ");
    if (same) {
      for (const r of rest) {
        r.status = "duplicate";
        r.messages.push({ level: "info", text: `Identical repeat of row ${first.rowNo}; ignored, so it is not counted twice.` });
      }
      first.messages.push({ level: "info", text: `Repeated identically on row${rest.length === 1 ? "" : "s"} ${rest.map((r) => r.rowNo).join(", ")}; counted once.` });
    } else {
      for (const r of g) {
        r.status = "conflict";
        r.messages.push({ level: "error", text: `The same company appears on rows ${rowsList} with different figures; none of them is imported.` });
      }
    }
  }

  // Match what is left against the Collection Master.
  for (const r of planned) {
    if (r.status !== "matched") continue;
    const co = existing.get(r.nameKey);
    if (!co) {
      r.status = "unmatched";
      r.messages.push({ level: "warning", text: "Not in the Collection Master; skipped. No company is created." });
    } else {
      r.companyId = co.id;
      r.companyName = co.companyName;
    }
  }

  const tot = {
    sheetRows: pair(),
    imported: pair(),
    unmatched: pair(),
    ignoredDuplicates: pair(),
    conflicting: pair(),
  };
  const add = (p: PaisePair, r: PlannedBalanceRow) => {
    p.debit += r.debitPaise ?? 0;
    p.credit += r.creditPaise ?? 0;
  };
  const count = { matched: 0, unmatched: 0, duplicates: 0, conflicts: 0, rejected: 0, negatives: 0 };
  for (const r of planned) {
    if (r.status !== "rejected") add(tot.sheetRows, r);
    if (r.status === "matched") {
      count.matched++;
      add(tot.imported, r);
      if (r.negative) count.negatives++;
    } else if (r.status === "unmatched") {
      count.unmatched++;
      add(tot.unmatched, r);
    } else if (r.status === "duplicate") {
      count.duplicates++;
      add(tot.ignoredDuplicates, r);
    } else if (r.status === "conflict") {
      count.conflicts++;
      add(tot.conflicting, r);
    } else count.rejected++;
  }

  let source: { debit: number; credit: number } | null = null;
  let sourcePaise: PaisePair | null = null;
  if (sourceTotal) {
    const d = parseMoney(sourceTotal.debit);
    const c = parseMoney(sourceTotal.credit);
    const dv = d.kind === "ok" ? d.paise : d.kind === "blank" ? 0 : null;
    const cv = c.kind === "ok" ? c.paise : c.kind === "blank" ? 0 : null;
    if (dv !== null && cv !== null) {
      sourcePaise = { debit: dv, credit: cv };
      source = out(sourcePaise);
    }
  }
  const tolerancePaise = totalsTolerancePaise(planned.length);
  const diffPaise = sourcePaise ? { debit: sourcePaise.debit - tot.sheetRows.debit, credit: sourcePaise.credit - tot.sheetRows.credit } : null;
  const inr = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let verification: TotalsVerification;
  if (sourceTotal === null) {
    verification = { status: "missing", tolerancePaise, differencePaise: null, message: "The file has no Grand Total row, so the rows can't be checked for completeness. Nothing can be imported." };
  } else if (diffPaise === null) {
    verification = { status: "unreadable", tolerancePaise, differencePaise: null, message: "The file's Grand Total isn't a readable number, so the rows can't be checked. Nothing can be imported." };
  } else if (Math.abs(diffPaise.debit) > tolerancePaise || Math.abs(diffPaise.credit) > tolerancePaise) {
    verification = {
      status: "mismatch",
      tolerancePaise,
      differencePaise: diffPaise,
      message: `The rows don't add up to the file's Grand Total (Debit off by ₹${inr(diffPaise.debit)}, Credit off by ₹${inr(diffPaise.credit)}; allowed ₹${inr(tolerancePaise)} for rounding). A row may be missing, invalid or altered. Nothing can be imported.`,
    };
  } else {
    verification = { status: "ok", tolerancePaise, differencePaise: diffPaise, message: null };
  }
  const difference = sourcePaise
    ? { debit: rupees(sourcePaise.debit - tot.sheetRows.debit), credit: rupees(sourcePaise.credit - tot.sheetRows.credit) }
    : null;

  return {
    rows: planned,
    toWrite: planned.filter((r) => r.status === "matched"),
    summary: {
      rows: planned.length,
      ...count,
      totals: {
        source,
        sheetRows: out(tot.sheetRows),
        imported: out(tot.imported),
        unmatched: out(tot.unmatched),
        ignoredDuplicates: out(tot.ignoredDuplicates),
        conflicting: out(tot.conflicting),
        difference,
      },
      verification,
      fingerprint: { matched: count.matched, debitPaise: tot.imported.debit, creditPaise: tot.imported.credit },
    },
  };
}
