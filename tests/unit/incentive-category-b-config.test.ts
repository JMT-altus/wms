import { describe, expect, it } from "vitest";
import { CATEGORY_B_TEMPLATE, REFERENCE_TEMPLATE, EMPTY_CONFIG, sectionsFor, settingsFor, referenceTemplateFor } from "@/lib/incentives/rules-config/spec";
import { checkConfig, diffConfigs, settingText } from "@/lib/incentives/rules-config/validate";
import { decide } from "@/lib/incentives/category-a/settle";
import { bConfig } from "../fixtures/category-b";

// The Category B settings catalogue and its checks (lib/incentives/rules-config). Pure.
const ctxB = { roles: ["doer", "initiator", "both"], category: "B" as const };
const keys = (c: "A" | "B") => settingsFor(c).map((d) => d.key);

describe("Category B's catalogue", () => {
  it("has its own sections (no slabs, threshold or allocation) and its own settings", () => {
    expect(sectionsFor("B").map((s) => s.key)).toEqual(["qualification", "delay", "partial", "adjustments", "people", "period", "rounding", "payout"]);
    for (const k of ["b.existingLookbackMonths", "b.noveltyWindow", "b.noveltyLookbackMonths", "b.minAmount", "b.ratePpm", "b.salesReturns", "b.recoveryExpiry", "caps.perOrder", "caps.perEmployeeCategoryMonth", "caps.perEmployeeAllCategoriesMonth", "caps.allCategoriesPolicy", "caps.allCategoriesOrder", "basis.voucherFilter", "collection.earningBasis", "adjust.negativeBalance", "attribution.source", "rounding.method", "payout.approvalSteps"]) expect(keys("B"), k).toContain(k);
    for (const k of ["slabs.method", "eligibility.threshold", "allocation.method", "collection.payableWhen", "adjust.creditNote", "basis.document", "basis.categoryBOrders"]) expect(keys("B"), k).not.toContain(k);
    for (const k of keys("A")) expect(k.startsWith("b."), k).toBe(false);
  });
  it("words the shared limits for Category B and narrows recovery to later months", () => {
    const def = (k: string) => settingsFor("B").find((d) => d.key === k)!;
    expect(def("caps.perEmployeeCategoryMonth").label).toBe("Most a salesperson can earn from Category B in a month");
    expect(def("caps.perOrder").label).toBe("Most one Sales Order can earn from Category B");
    expect(def("adjust.lockedOrPaidMonths").choices!.map((c) => c.value)).toEqual(["adjustInCurrentMonth"]);
    expect(def("adjust.negativeBalance").choices!.map((c) => c.value)).toEqual(["recoverFromNextPayout", "carryForwardMonths"]);
    expect(def("adjust.windowDays").requiredWhen).toEqual({ key: "b.recoveryExpiry", values: ["afterWindowDays"] });
    expect(def("caps.allCategoriesPolicy").required).toBe(true);
    // Category A keeps its own wording and optional new settings.
    expect(settingsFor("A").find((d) => d.key === "caps.perEmployeeCategoryMonth")!.label).toBe("Most a salesperson can earn from Category A in a month");
    expect(settingsFor("A").find((d) => d.key === "caps.allCategoriesPolicy")!.required).toBe(false);
  });
});

describe("the reference template: confirmed values only — never a rate or a limit", () => {
  it("fills the 24-month look back, ₹1,00,000 minimum and other confirmed values; leaves the rate and both limits empty", () => {
    expect(referenceTemplateFor("B")).toBe(CATEGORY_B_TEMPLATE);
    expect(referenceTemplateFor("A")).toBe(REFERENCE_TEMPLATE);
    expect(CATEGORY_B_TEMPLATE.settings).toMatchObject({ "b.existingLookbackMonths": 24, "b.minAmount": 1_00_000_00, "b.noveltyWindow": "sameAsExisting", "b.recoveryExpiry": "never", "b.salesReturns": "asCreditNote", "basis.voucherFilter": ["cancelled"], "caps.allCategoriesPolicy": "proportional" });
    for (const k of ["b.ratePpm", "caps.perOrder", "caps.perEmployeeCategoryMonth"]) expect(CATEGORY_B_TEMPLATE.settings[k], k).toBeUndefined();
    expect(CATEGORY_B_TEMPLATE.slabs).toEqual([]);
    const { problems, missing } = checkConfig(CATEGORY_B_TEMPLATE, ctxB);
    expect(problems).toEqual([]);
    for (const k of ["b.ratePpm", "caps.perOrder", "caps.perEmployeeCategoryMonth", "eligibility"]) expect(missing.map((m) => m.where), k).toContain(k);
  });
});

describe("checking a Category B configuration", () => {
  it("a complete one has neither problems nor anything missing", () => {
    expect(checkConfig(bConfig(), ctxB)).toEqual({ problems: [], missing: [] });
  });
  it("\"No limit\" is a value; a missing limit is missing", () => {
    const c = bConfig({ "caps.perEmployeeCategoryMonth": "none" });
    expect(checkConfig(c, ctxB).missing).toEqual([]);
    const settings = { ...c.settings };
    delete settings["caps.perEmployeeCategoryMonth"];
    expect(checkConfig({ ...c, settings }, ctxB).missing.map((m) => m.where)).toEqual(["caps.perEmployeeCategoryMonth"]);
    expect(settingText(settingsFor("B").find((d) => d.key === "caps.perEmployeeCategoryMonth")!, "none")).toBe("No limit");
  });
  it("the rate is a percentage from 0% to 100%", () => {
    expect(checkConfig(bConfig({ "b.ratePpm": 1_000_001 }), ctxB).problems.map((p) => p.where)).toEqual(["b.ratePpm"]);
    expect(settingText(settingsFor("B").find((d) => d.key === "b.ratePpm")!, 10_000)).toBe("1%");
  });
  it("cancelled orders must be left out; recovery can't be written off or taken from salary", () => {
    expect(checkConfig(bConfig({ "basis.voucherFilter": ["optional"] }), ctxB).problems.map((p) => p.where)).toEqual(["basis.voucherFilter"]);
    expect(checkConfig(bConfig({ "adjust.negativeBalance": "writeOff" }), ctxB).problems.map((p) => p.where)).toEqual(["adjust.negativeBalance"]);
    expect(checkConfig(bConfig({ "adjust.lockedOrPaidMonths": "noAdjustment" }), ctxB).problems.map((p) => p.where)).toEqual(["adjust.lockedOrPaidMonths"]);
  });
  it("an own novelty window, and an expiry after payout, are required only when chosen", () => {
    expect(checkConfig(bConfig({ "b.noveltyWindow": "own" }), ctxB).missing.map((m) => m.where)).toEqual([]);
    const c = bConfig({ "b.noveltyWindow": "own" });
    delete c.settings["b.noveltyLookbackMonths"];
    expect(checkConfig(c, ctxB).missing.map((m) => m.where)).toEqual(["b.noveltyLookbackMonths"]);
    const d = bConfig({ "b.recoveryExpiry": "afterWindowDays" });
    delete d.settings["adjust.windowDays"];
    expect(checkConfig(d, ctxB).missing.map((m) => m.where)).toEqual(["adjust.windowDays"]);
  });
  it("Category A settings on a Category B version, and slabs, are refused", () => {
    expect(checkConfig(bConfig({ "slabs.method": "marginal" }), ctxB).problems[0]!.message).toMatch(/isn't a Category B setting/);
    expect(checkConfig({ ...bConfig(), slabs: REFERENCE_TEMPLATE.slabs }, ctxB).problems.map((p) => p.where)).toEqual(["slabs"]);
    expect(checkConfig({ ...EMPTY_CONFIG, settings: { "b.minAmount": 1 } }, { roles: [] }).problems[0]!.message).toMatch(/isn't a Category A setting/);
  });
  it("differences are listed with Category B's own wording", () => {
    const diff = diffConfigs(bConfig(), bConfig({ "b.ratePpm": 20_000 }), "B");
    expect(diff).toEqual([{ section: "qualification", label: "Incentive rate", before: "1%", after: "2%" }]);
  });
});

describe("recovery after payout never lapses unless an expiry is configured", () => {
  const period = { month: "2026-04-01", status: "paid" as const, hasCurrentRun: true, currentRunSettled: false, paidAt: "2026-05-10T00:00:00Z" };
  const pay = { adopted: { e: 1_200_00 }, fresh: { e: 0 }, carried: {} };
  it("\"Never\": a credit note a year after payout is still recovered", () => {
    const d = decide(bConfig().settings, period, "2027-06-15", true, pay);
    expect(d.carries).toEqual([{ employeeId: "e", amountPaise: -1_200_00, toMonth: "2027-06-01" }]);
  });
  it("an approved expiry of 30 days: after it, the payout is final", () => {
    const d = decide(bConfig({ "b.recoveryExpiry": "afterWindowDays", "adjust.windowDays": 30 }).settings, period, "2026-07-15", true, pay);
    expect(d.carries).toEqual([]);
    expect(d.outcome).toMatch(/payout became final on 2026-06-09/);
  });
});
