import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIGURABLE_CATEGORIES, EMPTY_CONFIG, REFERENCE_TEMPLATE, SECTIONS, SETTING, SETTINGS, sectionsFor, settingsFor, type IncentiveConfig } from "@/lib/incentives/rules-config/spec";
import { applies, checkConfig, diffConfigs, readConfig, settingText } from "@/lib/incentives/rules-config/validate";
import { completeConfig as complete } from "../fixtures/incentive-config";

// The Incentive Rules catalogue (lib/incentives/rules-config/spec.ts) and its checks. Pure; nothing is calculated.
const ctx = { roles: ["doer", "initiator", "both"] };
const EMP = "11111111-1111-4111-8111-111111111111";
const completeConfig = (over: Partial<IncentiveConfig> = {}) =>
  complete(over, over.eligibility ?? [{ subjectType: "employee", subjectId: EMP, role: null, subjectLabel: "Sample Rep", mode: "include", effectiveFrom: "2026-04-01", effectiveTo: null }]);

describe("the catalogue", () => {
  it("Category A has its eleven sections, every setting in one of them, with help text and its source", () => {
    expect(sectionsFor("A").map((s) => s.label)).toEqual([
      "General Eligibility", "Monthly Sales Thresholds", "Incentive Slabs", "Incentive Allocation", "Collection and Payment Delay", "Partial Payment Rules",
      "Refunds and Adjustments", "Salesperson Eligibility", "Calculation Period", "Rounding and Limits", "Approval and Payout Rules",
    ]);
    for (const s of SECTIONS) expect(SETTINGS.some((d) => d.section === s.key), s.label).toBe(true);
    expect(new Set(SETTINGS.map((d) => d.key)).size).toBe(SETTINGS.length);
    for (const d of SETTINGS) {
      expect(d.help.length, d.key).toBeGreaterThan(10);
      if (d.kind === "choice" || d.kind === "multi" || d.kind === "ordered") expect(d.choices!.length, d.key).toBeGreaterThan(0);
      if (d.requiredWhen) expect(SETTING[d.requiredWhen.key], d.key).toBeTruthy();
    }
    expect(CONFIGURABLE_CATEGORIES).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    // Category A's 54 settings are unchanged; it gains only optional ones (absent = today's behaviour).
    const a = settingsFor("A");
    expect(a.filter((d) => d.required && !d.requiredWhen?.key.startsWith("caps.allCategories"))).toHaveLength(54);
    expect(a.filter((d) => !d.required).map((d) => d.key).sort()).toEqual(["basis.categoryBOrders", "caps.allCategoriesPolicy"]);
  });

  it("the database accepts exactly the catalogue's settings (0131's list for Category A, widened by 0134, 0135, 0136 and 0137)", () => {
    const listOf = (file: string, from: string, to: string) => {
      const sqlText = readFileSync(resolve(__dirname, `../../db/migrations/${file}`), "utf8");
      const block = sqlText.slice(sqlText.indexOf(from), sqlText.indexOf(to));
      return [...block.matchAll(/'([a-zA-Z.]+)'/g)].map((m) => m[1]).sort();
    };
    const original = listOf("0131_incentive_rule_config.sql", `"setting_key" IN (`, "CONSTRAINT \"incentive_config_settings_value_check\"");
    expect(original).toEqual(settingsFor("A").filter((d) => !["basis.categoryBOrders", "caps.allCategoriesPolicy", "caps.allCategoriesOrder"].includes(d.key)).map((d) => d.key).sort());
    // 0134 accepts Categories A and B's settings; 0135 every category's as they were; 0136 adds Category C's corrections
    // (turnover window and basis, minimum payable) — exactly the catalogue.
    const ADDED_0136 = ["c.turnoverWindowMonths", "c.turnoverBasis", "payout.minimumPayable", "payout.belowMinimum", "payout.carryForwardExpiry", "payout.carryForwardExpiryMonths"];
    // 0137 adds Category F's (named bonus, lowest rating, monthly minimum, recovery expiry).
    const ADDED_0137 = ["f.namedBonusAmount", "f.minRating", "f.minQualifyingReviews", "f.recoveryExpiry"];
    const later = [...ADDED_0136, ...ADDED_0137];
    expect(listOf("0134_incentive_category_b.sql", `-- settings-key-list-begin`, `-- settings-key-list-end`)).toEqual(SETTINGS.map((d) => d.key).filter((k) => !/^[c-g]\./.test(k) && !later.includes(k)).sort());
    expect(listOf("0135_incentive_categories_c_g.sql", `-- settings-key-list-begin`, `-- settings-key-list-end`)).toEqual(SETTINGS.map((d) => d.key).filter((k) => !later.includes(k)).sort());
    expect(listOf("0136_incentive_category_c_review.sql", `-- settings-key-list-begin`, `-- settings-key-list-end`)).toEqual(SETTINGS.map((d) => d.key).filter((k) => !ADDED_0137.includes(k)).sort());
    expect(listOf("0137_incentive_category_f_reviews.sql", `-- settings-key-list-begin`, `-- settings-key-list-end`)).toEqual(SETTINGS.map((d) => d.key).sort());
  });

  it("the reference template fills only what the PDF and the April examples establish; every business decision stays empty", () => {
    for (const key of Object.keys(REFERENCE_TEMPLATE.settings)) expect(SETTING[key]!.source, key).not.toBe("option");
    for (const d of settingsFor("A").filter((x) => x.source === "pdf" || x.source === "screenshot")) expect(REFERENCE_TEMPLATE.settings[d.key], d.key).not.toBeUndefined();
    // Its slabs and steps are the PDF's, and it says nothing about who is covered.
    expect(REFERENCE_TEMPLATE.slabs.map((s) => [s.lineCode, s.fromPaise, s.toPaise, s.ratePpm, s.capPaise])).toEqual([
      ["A.1", 1_00_00_000_00, 1_20_00_000_00, 1000, 2000_00],
      ["A.2", 1_20_00_000_00, 1_40_00_000_00, 1500, 3000_00],
      ["A.3", 1_40_00_000_00, 1_60_00_000_00, 2000, 4000_00],
    ]);
    expect(REFERENCE_TEMPLATE.delaySteps.map((s) => [s.fromDays, s.toDays, s.multiplierPpm])).toEqual([[0, 45, 1_000_000], [45, 75, 500_000], [75, 100, 250_000], [100, null, 0]]);
    expect(REFERENCE_TEMPLATE.eligibility).toEqual([]);
  });
});

describe("checking a configuration", () => {
  it("an empty draft has no problems, only everything missing", () => {
    const { problems, missing } = checkConfig(EMPTY_CONFIG, ctx);
    expect(problems).toEqual([]);
    const requiredNow = settingsFor("A").filter((d) => d.required && applies(d, {})).length;
    expect(missing).toHaveLength(requiredNow + 3); // + slabs, delay steps, eligibility
  });

  it("the reference template is missing exactly the business decisions (and who is covered)", () => {
    const { problems, missing } = checkConfig(REFERENCE_TEMPLATE, ctx);
    expect(problems).toEqual([]);
    const keys = missing.map((m) => m.where);
    expect(keys).toContain("eligibility.thresholdComparison");
    expect(keys).toContain("allocation.method");
    expect(keys).toContain("rounding.method");
    expect(keys).toContain("eligibility");
    expect(keys).not.toContain("eligibility.threshold");
    expect(keys).not.toContain("slabs");
    for (const k of keys.filter((x) => SETTING[x])) expect(SETTING[k]!.source, k).toBe("option");
  });

  it("a complete configuration has neither", () => {
    expect(checkConfig(completeConfig(), ctx)).toEqual({ problems: [], missing: [] });
  });

  it("a setting that depends on another is required only while that holds", () => {
    const c = completeConfig();
    delete c.settings["slabs.aboveTopAmount"];
    c.settings["slabs.aboveTop"] = "noFurtherIncentive";
    expect(checkConfig(c, ctx).missing).toEqual([]);
    c.settings["slabs.aboveTop"] = "fixedAmount";
    expect(checkConfig(c, ctx).missing.map((m) => m.where)).toEqual(["slabs.aboveTopAmount"]);
    // A multi-choice setting: "Default days" is needed only once "defaultDays" is in the fallback list.
    c.settings["slabs.aboveTopAmount"] = 500_00;
    delete c.settings["collection.defaultDays"];
    c.settings["collection.dueDateFallback"] = ["invoiceDueDate"];
    expect(checkConfig(c, ctx).missing).toEqual([]);
    c.settings["collection.dueDateFallback"] = ["invoiceDueDate", "defaultDays"];
    expect(checkConfig(c, ctx).missing.map((m) => m.where)).toEqual(["collection.defaultDays"]);
  });

  it("refuses wrong values of every kind", () => {
    const bad = (key: string, value: unknown) => checkConfig(completeConfig({ settings: { ...completeConfig().settings, [key]: value as never } }), ctx).problems.map((p) => p.message).join(" ");
    expect(bad("slabs.method", "steep")).toMatch(/Choose one of the listed options/);
    expect(bad("basis.voucherFilter", ["cancelled", "cancelled"])).toMatch(/chosen twice/);
    expect(bad("basis.voucherFilter", ["deleted"])).toMatch(/Only the listed options/);
    expect(bad("collection.dueDateFallback", [])).toMatch(/at least one/);
    expect(bad("eligibility.threshold", -1)).toMatch(/₹0 or more/);
    expect(bad("eligibility.threshold", 1.5)).toMatch(/₹0 or more/);
    expect(bad("caps.perOrder", "unlimited")).toMatch(/No limit/);
    expect(bad("payout.approvalSteps", 4)).toMatch(/from 1 to 3/);
    expect(checkConfig({ ...EMPTY_CONFIG, settings: { "made.up": "x" } }, ctx).problems[0]!.message).toMatch(/isn't an Incentive Rules setting/);
  });

  it("slabs: in order, ending above where they start, no overlap, no gap unless gaps are allowed, one kind of value each", () => {
    const base = completeConfig();
    const slabs = (s: IncentiveConfig["slabs"]) => checkConfig({ ...base, slabs: s }, ctx).problems.map((p) => p.message).join(" ");
    const [a1, a2, a3] = base.slabs as [IncentiveConfig["slabs"][0], IncentiveConfig["slabs"][0], IncentiveConfig["slabs"][0]];
    expect(slabs([a1, { ...a2, fromPaise: a1.toPaise - 1 }, a3])).toMatch(/Slabs 1 and 2 overlap/);
    expect(slabs([a1, { ...a2, fromPaise: a1.toPaise + 100 }, a3])).toMatch(/gap between slabs 1 and 2/);
    expect(checkConfig({ ...base, settings: { ...base.settings, "slabs.gaps": "allow" }, slabs: [a1, { ...a2, fromPaise: a1.toPaise + 100 }, a3] }, ctx).problems).toEqual([]);
    expect(slabs([a2, a1, a3])).toMatch(/must be in order/);
    expect(slabs([{ ...a1, toPaise: a1.fromPaise }])).toMatch(/end above where it starts/);
    expect(slabs([{ ...a1, ratePpm: 1_000_001 }])).toMatch(/from 0% to 100%/);
    expect(slabs([{ ...a1, valueType: "fixed", ratePpm: 1000, fixedPaise: 100 }])).toMatch(/a fixed-amount slab has no rate/);
    expect(slabs([a1, { ...a2, lineCode: "a.1" }])).toMatch(/used twice/);
    expect(slabs([{ ...a1, valueType: "fixed", ratePpm: null, fixedPaise: 500_00 }, a2, a3])).toBe("");
  });

  it("delay steps: from day 0, each starting where the last ended, only the last open-ended, 0–100%", () => {
    const base = completeConfig();
    const steps = (s: IncentiveConfig["delaySteps"]) => checkConfig({ ...base, delaySteps: s }, ctx).problems.map((p) => p.message).join(" ");
    expect(steps([{ fromDays: 1, toDays: null, multiplierPpm: 0 }])).toMatch(/must start at day 0/);
    expect(steps([{ fromDays: 0, toDays: 45, multiplierPpm: 1_000_000 }, { fromDays: 46, toDays: null, multiplierPpm: 0 }])).toMatch(/must start where step 1 ends/);
    expect(steps([{ fromDays: 0, toDays: 45, multiplierPpm: 1_000_000 }])).toMatch(/the last step has no end/);
    expect(steps([{ fromDays: 0, toDays: null, multiplierPpm: 1_000_000 }, { fromDays: 0, toDays: null, multiplierPpm: 0 }])).toMatch(/give its last day/);
    expect(steps([{ fromDays: 0, toDays: null, multiplierPpm: 2_000_000 }])).toMatch(/from 0% to 100%/);
    expect(steps([{ fromDays: 0, toDays: null, multiplierPpm: 1_000_000 }])).toBe("");
  });

  it("eligibility: a known role, an id for a person or department, sensible dates, no overlapping duplicates", () => {
    const base = completeConfig();
    const rows = (r: IncentiveConfig["eligibility"]) => checkConfig({ ...base, eligibility: r }, ctx).problems.map((p) => p.message).join(" ");
    const row = base.eligibility[0]!;
    expect(rows([{ ...row, subjectType: "role", subjectId: null, role: "manager" }])).toMatch(/one of the employee roles/);
    expect(rows([{ ...row, subjectId: "not-an-id" }])).toMatch(/choose the employee/);
    expect(rows([{ ...row, effectiveTo: "2026-03-01" }])).toMatch(/on or after its start date/);
    expect(rows([{ ...row, effectiveFrom: "2026-02-30" }])).toMatch(/give the date it starts/);
    expect(rows([row, { ...row, effectiveFrom: "2026-06-01" }])).toMatch(/overlapping dates/);
    expect(rows([{ ...row, effectiveTo: "2026-05-31" }, { ...row, effectiveFrom: "2026-06-01" }])).toBe("");
    expect(rows([row, { ...row, mode: "exclude", effectiveFrom: "2026-09-01" }])).toBe(""); // include and exclude may overlap
    expect(checkConfig({ ...base, eligibility: [{ ...row, mode: "exclude" }] }, ctx).missing.map((m) => m.where)).toEqual(["eligibility"]);
  });
});

describe("reading untrusted input", () => {
  it("accepts only the catalogue's shapes", () => {
    expect(readConfig(completeConfig())).toEqual({ ok: true, config: completeConfig() });
    expect(readConfig({ ...completeConfig(), extra: 1 })).toMatchObject({ ok: false });
    expect(readConfig({ ...completeConfig(), settings: { "select pg_sleep(10)": "x" } })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't an Incentive Rules setting/) });
    expect(readConfig({ ...completeConfig(), settings: { "slabs.method": { $code: "x" } } })).toMatchObject({ ok: false });
    expect(readConfig({ ...completeConfig(), slabs: [{ ...completeConfig().slabs[0], formula: "rate*2" }] })).toMatchObject({ ok: false });
    expect(readConfig({ ...completeConfig(), delaySteps: [{ fromDays: 0, toDays: null, multiplierPpm: { x: 1 } }] })).toMatchObject({ ok: false });
    // Blank values are simply "not set".
    expect(readConfig({ ...EMPTY_CONFIG, settings: { "slabs.method": "", "eligibility.threshold": null } })).toEqual({ ok: true, config: EMPTY_CONFIG });
  });
});

describe("comparing", () => {
  it("names each changed setting and list, in words", () => {
    const a = completeConfig();
    const b = completeConfig({ settings: { ...a.settings, "slabs.method": "flat", "caps.perOrder": 500_00 }, slabs: a.slabs.slice(0, 2) });
    const d = diffConfigs(a, b);
    expect(d.map((x) => x.label)).toEqual(["How slabs are applied", "Most one order can earn", "Incentive slabs"]);
    expect(d[0]).toMatchObject({ before: "Marginal (each slab on its own part)", after: "Flat (reached slab's rate on all sales)" });
    expect(d[1]).toMatchObject({ before: "No limit", after: "₹500" });
    expect(diffConfigs(a, a)).toEqual([]);
    expect(settingText(SETTING["eligibility.threshold"]!, 1_00_00_000_00)).toBe("₹1,00,00,000");
  });
});
