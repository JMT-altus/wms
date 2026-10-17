import { describe, expect, it } from "vitest";
import { buildMasterPlan, type ExistingCompany } from "@/lib/collections/master/plan";
import { nameKey } from "@/lib/collections/master/normalize";
import type { MasterSourceRow } from "@/lib/collections/master/workbook";

let n = 1;
const row = (company: string, coordinator = "", paymentTerms = ""): MasterSourceRow => ({ rowNo: ++n, company, coordinator, paymentTerms });
const MAPPED = { mapped: { coordinator: true, paymentTerms: true } };
const stored = (companyName: string, coordinatorLabel: string | null, paymentTerms: string | null): ExistingCompany => ({
  id: `id-${nameKey(companyName)}`,
  companyName,
  nameKey: nameKey(companyName),
  coordinatorLabel,
  paymentTerms,
  customerMasterId: null,
});
const plan = (rows: MasterSourceRow[], existing: ExistingCompany[] = [], clients: Record<string, string[]> = {}, opts = MAPPED) =>
  buildMasterPlan(rows, new Map(existing.map((e) => [e.nameKey, e])), new Map(Object.entries(clients)), opts);

describe("validation", () => {
  it("rejects blank names, names with no letters or digits, and over-long values", () => {
    const p = plan([row(""), row("---"), row("A".repeat(201)), row("Fine Co", "BK".repeat(101))]);
    expect(p.rows.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    expect(p.rows[0]!.messages[0]!.text).toMatch(/blank/);
    expect(p.summary.rejected).toBe(4);
  });

  it("placeholder and blank coordinators become Unassigned; blank terms stay blank", () => {
    const p = plan([row("Alpha", "XXX"), row("Beta", "-"), row("Gamma", ""), row("Delta", "BK", "30 days")]);
    expect(p.rows.map((r) => r.coordinatorLabel)).toEqual([null, null, null, "BK"]);
    expect(p.rows.map((r) => r.paymentTerms)).toEqual([null, null, null, "30 days"]);
    expect(p.summary).toMatchObject({ new: 4, newWithoutCoordinator: 3, placeholderCoordinators: 2, newWithoutPaymentTerms: 3 });
    expect(p.rows[0]!.messages.some((m) => /placeholder/.test(m.text))).toBe(true);
  });

  it("an unmapped field is never read, even if the row carries a value", () => {
    const p = plan([row("Alpha", "BK", "Advance")], [], {}, { mapped: { coordinator: false, paymentTerms: false } });
    expect(p.rows[0]).toMatchObject({ coordinatorLabel: null, paymentTerms: null, coordinatorPlaceholder: false });
  });
});

describe("duplicates and conflicts in the file", () => {
  it("repeats of the same company become duplicates of the first row, merging blanks", () => {
    const p = plan([row("ABC Traders", "BK"), row("abc  traders.", ""), row("ABC TRADERS", "XXX", "30 days")]);
    expect(p.rows.map((r) => r.status)).toEqual(["new", "duplicate", "duplicate"]);
    expect(p.rows[0]).toMatchObject({ coordinatorLabel: "BK", paymentTerms: "30 days" });
    expect(p.rows[1]!.duplicateOf).toBe(p.rows[0]!.rowNo);
    expect(p.summary).toMatchObject({ new: 1, duplicate: 2, conflictGroups: 0 });
  });

  it("conflicting coordinators reject every row of that company — nothing is picked", () => {
    const p = plan([row("ABC Traders", "BK"), row("ABC Traders", "GR"), row("Other", "BK")]);
    expect(p.rows.map((r) => r.status)).toEqual(["rejected", "rejected", "new"]);
    expect(p.rows[0]!.messages[0]!.text).toMatch(/different coordinators \(BK \/ GR\)/);
    expect(p.summary.conflictGroups).toBe(1);
  });

  it("conflicting payment terms are a conflict too; same text in another case is not", () => {
    expect(plan([row("A Co", "", "30 days"), row("A Co", "", "45 days")]).summary.conflictGroups).toBe(1);
    expect(plan([row("A Co", "bk", "30 Days"), row("A Co", "BK", "30 days")]).summary).toMatchObject({ conflictGroups: 0, new: 1, duplicate: 1 });
  });
});

describe("Client Master matching", () => {
  it("links only on exactly one exact name match", () => {
    const p = plan([row("Alpha Traders"), row("Beta Corp"), row("Gamma Ltd")], [], { "alpha traders": ["c1"], "beta corp": ["c2", "c3"] });
    expect(p.rows.map((r) => [r.clientMatch, r.customerMasterId])).toEqual([
      ["linked", "c1"],
      ["ambiguous", null],
      ["none", null],
    ]);
    expect(p.rows[1]!.messages.some((m) => /2 Client Master records/.test(m.text))).toBe(true);
    expect(p.summary).toMatchObject({ clientLinked: 1, clientAmbiguous: 1 });
  });

  it("does not link on a loose match (punctuation differs)", () => {
    const p = plan([row("Alpha Traders Pvt. Ltd.")], [], { "alpha traders pvt ltd": ["c1"] });
    expect(p.rows[0]!.clientMatch).toBe("none");
  });
});

describe("safe re-upload", () => {
  it("unchanged companies are reported as unchanged", () => {
    const p = plan([row("Alpha", "BK", "30 days")], [stored("Alpha", "BK", "30 days")]);
    expect(p.rows[0]).toMatchObject({ status: "unchanged", existingId: "id-alpha", changes: [] });
  });

  it("a blank or placeholder in the new file never clears a stored value", () => {
    const p = plan([row("Alpha", "XXX", ""), row("Beta", "", "")], [stored("Alpha", "BK", "30 days"), stored("Beta", null, null)]);
    expect(p.rows.map((r) => r.status)).toEqual(["unchanged", "unchanged"]);
    expect(p.rows[0]!.changes).toEqual([]);
    expect(p.rows[0]!.messages.map((m) => m.text).join(" ")).toMatch(/existing assignment is kept/);
  });

  it("a different value is a proposed change with before and after, not applied by the plan", () => {
    const p = plan([row("Alpha", "GR", "45 days")], [stored("Alpha", "BK", "30 days")]);
    expect(p.rows[0]!.status).toBe("changed");
    expect(p.rows[0]!.changes).toEqual([
      { field: "coordinatorLabel", from: "BK", to: "GR" },
      { field: "paymentTerms", from: "30 days", to: "45 days" },
    ]);
    expect(p.summary.changed).toBe(1);
  });

  it("filling a stored blank is also a change that needs acceptance", () => {
    const p = plan([row("Alpha", "BK")], [stored("Alpha", null, null)]);
    expect(p.rows[0]!.changes).toEqual([{ field: "coordinatorLabel", from: null, to: "BK" }]);
  });

  it("keeps the stored spelling of the name", () => {
    const p = plan([row("ALPHA", "BK")], [stored("Alpha", "BK", null)]);
    expect(p.rows[0]!.status).toBe("unchanged");
    expect(p.rows[0]!.messages.some((m) => /that spelling is kept/.test(m.text))).toBe(true);
  });

  it("an unmapped column never proposes clearing or changing stored values", () => {
    const p = plan([row("Alpha")], [stored("Alpha", "BK", "30 days")], {}, { mapped: { coordinator: false, paymentTerms: false } });
    expect(p.rows[0]).toMatchObject({ status: "unchanged", changes: [] });
  });
});
