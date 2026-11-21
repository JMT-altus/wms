import { describe, expect, it } from "vitest";
import { CATEGORY_TEMPLATES, EMPTY_CONFIG, referenceTemplateFor, sectionsFor, settingsFor, type CategoryCode } from "@/lib/incentives/rules-config/spec";
import { checkConfig } from "@/lib/incentives/rules-config/validate";
import { completeConfig } from "../fixtures/incentive-config";

// Categories C–G's settings catalogue and checks. Pure.
const ctx = (category: CategoryCode) => ({ roles: ["doer", "initiator", "both"], category });
const keys = (c: CategoryCode) => settingsFor(c).map((d) => d.key);

describe("each category has only the settings that mean something for it", () => {
  it("C and G (from Forms) have the order filter and attribution; only C has receipts and delay steps", () => {
    for (const c of ["C", "G"] as const) expect(keys(c)).toEqual(expect.arrayContaining(["basis.voucherFilter", "attribution.source", "caps.perOrder"]));
    expect(keys("C")).toEqual(expect.arrayContaining(["collection.delayFrom", "collection.onAccountReceipts", "adjust.refund", "c.ratePpm", "c.minTurnover"]));
    expect(keys("G")).not.toContain("collection.delayFrom");
    expect(sectionsFor("C").map((s) => s.key)).toContain("delay");
    expect(sectionsFor("G").map((s) => s.key)).toEqual(expect.arrayContaining(["streak", "general", "people"]));
  });
  it("D, E and F (approved submissions) have no document, attribution or collection settings", () => {
    for (const c of ["D", "E", "F"] as const) {
      for (const k of ["basis.voucherFilter", "attribution.source", "collection.delayFrom", "caps.perOrder", "slabs.method"]) expect(keys(c), `${c} ${k}`).not.toContain(k);
      for (const k of ["caps.perEmployeeCategoryMonth", "caps.perEmployeeAllCategoriesMonth", "caps.allCategoriesPolicy", "payout.approvalSteps", "period.lockMode", "rounding.method"]) expect(keys(c), `${c} ${k}`).toContain(k);
    }
    expect(keys("D").filter((k) => k.startsWith("d."))).toHaveLength(6);
    expect(keys("E").filter((k) => k.startsWith("e."))).toEqual(["e.minAward", "e.maxAward"]);
    // F.1–F.4 (0138): Google review, email, letterhead, appreciation multiple; lowest rating, fewest words, monthly
    // minimum, screenshot, recovery expiry; 2 historical (five stars only, the superseded named bonus).
    expect(keys("F").filter((k) => k.startsWith("f."))).toHaveLength(11);
    const req = (k: string) => settingsFor("F").find((d) => d.key === k)!.required;
    for (const k of ["f.googleReviewAmount", "f.emailAmount", "f.letterheadAmount", "f.namedMultiple"]) expect(req(k), k).toBe(true);
    for (const k of ["f.namedBonusAmount", "f.googleFiveStarOnly"]) expect(req(k), k).toBe(false);
  });
  it("C uses Category A's receipt-based earning and credit-note / return rules — narrowed to the confirmed choices — and the minimum payable; no other category gets them", () => {
    expect(keys("C")).toEqual(expect.arrayContaining(["collection.earningBasis", "collection.payableWhen", "adjust.creditNote", "adjust.salesReturn", "c.turnoverWindowMonths", "c.turnoverBasis", "payout.minimumPayable", "payout.belowMinimum"]));
    for (const c of ["B", "D", "E", "F", "G"] as const) for (const k of ["collection.payableWhen", "adjust.creditNote", "adjust.salesReturn", "payout.minimumPayable", "payout.belowMinimum"]) expect(keys(c), `${c} ${k}`).not.toContain(k);
    const def = (k: string) => settingsFor("C").find((d) => d.key === k)!;
    expect(def("collection.payableWhen").choices!.map((x) => x.value)).toEqual(["orderFullyCollected"]);
    expect(def("adjust.creditNote").choices!.map((x) => x.value)).toEqual(["reduceOriginalMonthSales"]);
    expect(def("adjust.salesReturn").choices!.map((x) => x.value)).toEqual(["reduceOriginalMonthSales"]);
    expect(def("payout.minimumPayable")).toMatchObject({ kind: "cap", noneLabel: "No minimum", required: true });
    // Category A's own meaning of these settings is unchanged.
    expect(settingsFor("A").find((d) => d.key === "adjust.creditNote")!.choices!.length).toBe(4);
    // A partial-collection or "ignore credit notes" choice is refused for C.
    const c = completeConfig({}, undefined, "C");
    expect(checkConfig({ ...c, settings: { ...c.settings, "collection.payableWhen": "asReceived", "adjust.creditNote": "ignore" } }, ctx("C")).problems.map((p) => p.where).sort()).toEqual(["adjust.creditNote", "collection.payableWhen"]);
  });
  it("a category's own settings never appear in another's catalogue", () => {
    for (const c of ["A", "B", "C", "D", "E", "F", "G"] as const) for (const k of keys(c)) if (/^[b-g]\./.test(k)) expect(k[0]!.toUpperCase(), k).toBe(c);
  });
});

describe("templates: the old engine's PDF values only; G has none", () => {
  it("C–F start from the PDF values; every undecided value stays empty", () => {
    expect(CATEGORY_TEMPLATES.C!.settings).toMatchObject({ "c.requiredTransactions": 3, "c.minTurnover": 2_50_000_00, "c.ratePpm": 10_000, "caps.perOrder": 5_000_00 });
    // Confirmed (12-month look-back) and recommended (12-month turnover window, invoiced net turnover, per-receipt,
    // fully collected, credit notes and returns reduce the order, below-minimum carried forward with no expiry) — editable starting values.
    expect(CATEGORY_TEMPLATES.C!.settings).toMatchObject({ "c.newCustomerLookbackMonths": 12, "c.turnoverWindowMonths": 12, "c.turnoverBasis": "invoiced", "collection.earningBasis": "perReceipt", "collection.payableWhen": "orderFullyCollected", "adjust.creditNote": "reduceOriginalMonthSales", "adjust.salesReturn": "reduceOriginalMonthSales", "payout.belowMinimum": "carryForward", "payout.carryForwardExpiry": "never" });
    expect(CATEGORY_TEMPLATES.C!.settings["c.amountBasis"]).toBeUndefined();
    // No minimum amount is assumed: "No minimum" or an amount must be chosen.
    expect(CATEGORY_TEMPLATES.C!.settings["payout.minimumPayable"]).toBeUndefined();
    expect(CATEGORY_TEMPLATES.D!.settings["d.unitCounting"]).toBeUndefined();
    // Category F: the original scheme (F.1 ₹100, F.2 ₹100, F.3 ₹150, F.4 double), five stars, no word or count minimum,
    // a screenshot, recovery never lapses. The ₹750 limit is NOT in it: its scope isn't confirmed (see below).
    expect(CATEGORY_TEMPLATES.F!.settings).toMatchObject({ "f.googleReviewAmount": 100_00, "f.emailAmount": 100_00, "f.letterheadAmount": 150_00, "f.namedMultiple": 2, "f.minRating": 5, "f.googleMinWords": 0, "f.minQualifyingReviews": 0, "f.googleNeedsEvidence": "yes", "f.recoveryExpiry": "never" });
    for (const old of ["f.namedBonusAmount", "f.googleFiveStarOnly", "caps.perEmployeeCategoryMonth"]) expect(CATEGORY_TEMPLATES.F!.settings[old], old).toBeUndefined();
    expect(referenceTemplateFor("G")).toEqual(EMPTY_CONFIG);
  });
  it("Category F: the unresolved monthly limit (PDF ₹750, scope unconfirmed) blocks submission and publishing until a value is entered", () => {
    const { problems, missing } = checkConfig(referenceTemplateFor("F"), ctx("F"));
    expect(problems).toEqual([]);
    expect(missing.map((m) => m.where)).toContain("caps.perEmployeeCategoryMonth");
    expect(settingsFor("F").find((d) => d.key === "caps.perEmployeeCategoryMonth")!.help).toMatch(/₹750 for Category F\. NOT YET CONFIRMED: whether it is per salesperson per month, and whether F\.4 doubled rewards count inside it/);
    // Once an approved value is entered (here ₹750) nothing about the limit is missing any more.
    const c = completeConfig({}, undefined, "F");
    expect(checkConfig({ ...c, settings: { ...c.settings, "caps.perEmployeeCategoryMonth": 750_00 } }, ctx("F"))).toEqual({ problems: [], missing: [] });
  });
  it("no template is publishable as it is: each still misses decisions", () => {
    for (const c of ["C", "D", "E", "F", "G"] as const) {
      const { problems, missing } = checkConfig(referenceTemplateFor(c), ctx(c));
      expect(problems, c).toEqual([]);
      expect(missing.length, c).toBeGreaterThan(0);
    }
  });
});

describe("checks", () => {
  it("a complete configuration of each category has neither problems nor anything missing", () => {
    for (const c of ["C", "D", "E", "F", "G"] as const) expect(checkConfig(completeConfig({}, undefined, c), ctx(c)), c).toEqual({ problems: [], missing: [] });
  });
  it("D, E, F and G have no delay steps; C must have them", () => {
    const steps = [{ fromDays: 0, toDays: null, multiplierPpm: 1_000_000 }];
    expect(checkConfig({ ...completeConfig({}, undefined, "D"), delaySteps: steps }, ctx("D")).problems.map((p) => p.where)).toEqual(["delaySteps"]);
    expect(checkConfig({ ...completeConfig({}, undefined, "C"), delaySteps: [] }, ctx("C")).missing.map((m) => m.where)).toEqual(["delaySteps"]);
  });
  it("E's smallest award can't exceed its largest; C must leave cancelled orders out", () => {
    const e = completeConfig({}, undefined, "E");
    expect(checkConfig({ ...e, settings: { ...e.settings, "e.minAward": 2_000_00, "e.maxAward": 1_000_00 } }, ctx("E")).problems.map((p) => p.where)).toEqual(["e.minAward"]);
    const c = completeConfig({}, undefined, "C");
    expect(checkConfig({ ...c, settings: { ...c.settings, "basis.voucherFilter": [] } }, ctx("C")).problems.map((p) => p.where)).toEqual(["basis.voucherFilter"]);
  });
  it("every monthly limit is worded for its category, and \"No limit\" stays a deliberate choice", () => {
    for (const c of ["C", "D", "E", "F", "G"] as const) expect(settingsFor(c).find((d) => d.key === "caps.perEmployeeCategoryMonth")!.label).toBe(`Most a salesperson can earn from Category ${c} in a month`);
  });
});
