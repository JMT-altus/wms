import { describe, it, expect } from "vitest";
import { lineBalance, paiseText, planClosures, type UploadedLine } from "@/lib/collections/balances/closures";
import { buildBalancePlan, parseMoney } from "@/lib/collections/balances/plan";

// Which companies a confirmed upload moves between the Collection Tracker and Collection Logs. Pure rule.

const line = (companyId: string, debitPaise: number | null, creditPaise: number | null): UploadedLine => ({ companyId, debitPaise, creditPaise });

describe("a line's balance", () => {
  it("zero only when both sides are zero; a blank side beside a zero is zero; both blank is unknown", () => {
    expect(lineBalance(line("a", 0, 0))).toBe("zero");
    expect(lineBalance(line("a", 0, null))).toBe("zero");
    expect(lineBalance(line("a", null, 0))).toBe("zero");
    expect(lineBalance(line("a", null, null))).toBe("unknown");
    expect(lineBalance(line("a", 50000, 0))).toBe("non-zero");
    expect(lineBalance(line("a", 0, 50000))).toBe("non-zero");
    expect(lineBalance(line("a", -1000, 0))).toBe("non-zero"); // a negative is a balance
    expect(lineBalance(line("a", 1, 0))).toBe("non-zero"); // one paisa is not zero
    expect(lineBalance(line("a", 0.5, 0))).toBe("unknown"); // never a fraction of a paisa
  });
});

describe("planClosures — the examples table", () => {
  const open = new Set(["inLogs1", "inLogs2", "inLogs3", "inLogs4"]);
  const plan = planClosures(
    [
      line("tracker1", 0, 0), // Tracker, 0 / 0 → Logs
      line("tracker2", 0, 500000), // Tracker, Credit 5000 → Tracker
      line("tracker3", 250000, 0), // Tracker, Debit 2500 → Tracker
      line("inLogs1", 0, 500000), // Logs, Credit 5000 → Tracker
      line("inLogs2", 250000, 0), // Logs, Debit 2500 → Tracker
      line("inLogs3", 0, 0), // Logs, 0 / 0 → Logs
      line("inLogs4", 0, 0), // Logs, "-" / "-" (read as 0 / 0) → Logs
      line("unknown", null, null), // can't be determined → nothing
    ],
    open,
  );
  it("moves exactly the companies the table says", () => {
    expect(plan.close.map((l) => l.companyId)).toEqual(["tracker1"]);
    expect(plan.reopen.map((l) => l.companyId)).toEqual(["inLogs1", "inLogs2"]);
    expect(plan.unchanged).toBe(4); // tracker2, tracker3, inLogs3, inLogs4
    expect(plan.unknown).toBe(1);
  });
  it("never looks at a company that is not in the upload", () => {
    const p = planClosures([line("tracker1", 100, 0)], open);
    expect(p.reopen).toEqual([]);
    expect(p.close).toEqual([]);
  });
  it("decides a repeated company once, by its first line", () => {
    const p = planClosures([line("x", 0, 0), line("x", 0, 0)], new Set());
    expect(p.close).toHaveLength(1);
  });
});

describe("dashes are the importer's zero", () => {
  it("a lone dash reads as ₹0; a minus sign on a number still means negative", () => {
    for (const d of ["-", " - ", "–", "—"]) expect(parseMoney(d)).toEqual({ kind: "ok", paise: 0 });
    expect(parseMoney("-500")).toEqual({ kind: "ok", paise: -50000 });
    expect(parseMoney("--")).toMatchObject({ kind: "error" });
    expect(parseMoney("- 5")).toMatchObject({ kind: "error" });
  });
  it("a row of dashes is a ₹0 / ₹0 line, matched and written like any other", () => {
    const companies = new Map([["deltaco", { id: "d", companyName: "Delta Co" }]]);
    const plan = buildBalancePlan([{ rowNo: 5, name: "Delta Co", debit: "-", credit: "-" }], companies, { debit: "-", credit: "-" });
    expect(plan.summary.verification.status).toBe("ok");
    expect(plan.toWrite.map((r) => [r.debitPaise, r.creditPaise])).toEqual([[0, 0]]);
    expect(lineBalance({ debitPaise: plan.toWrite[0]!.debitPaise, creditPaise: plan.toWrite[0]!.creditPaise })).toBe("zero");
  });
  it("a row with both cells blank is still rejected, so nothing about that company is known", () => {
    const companies = new Map([["deltaco", { id: "d", companyName: "Delta Co" }]]);
    const plan = buildBalancePlan([{ rowNo: 5, name: "Delta Co", debit: "", credit: "" }], companies, { debit: "0", credit: "0" });
    expect(plan.toWrite).toEqual([]);
    expect(plan.summary.rejected).toBe(1);
  });
});

describe("paiseText", () => {
  it("exact numeric text", () => {
    expect([paiseText(0), paiseText(5), paiseText(123456), paiseText(-250), paiseText(null)]).toEqual(["0.00", "0.05", "1234.56", "-2.50", null]);
  });
});
