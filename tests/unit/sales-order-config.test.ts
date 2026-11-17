import { describe, expect, it } from "vitest";
import {
  BASE_CATALOGUE,
  FIELD_SCOPES,
  LOCKED_FIELD_KEYS,
  activeFields,
  buildCatalogue,
  conditionHolds,
  customKey,
  describeRule,
  formFields,
  importFields,
  isCondition,
  isRequired,
  preCloseFields,
  storedPath,
  validateSetting,
  type FieldScope,
  type FieldSetting,
  type SettingInput,
} from "@/lib/tally/sales-order-config";

// The effective Sales Order field configuration: the Tally matrix with administrators' settings over it.
const setting = (over: Partial<FieldSetting> & Pick<FieldSetting, "fieldKey" | "scope">): FieldSetting => ({
  isCustom: false, label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", rowVersion: 1, ...over,
});
const input = (over: Partial<SettingInput> & Pick<SettingInput, "scope">): SettingInput => ({
  fieldKey: null, isCustom: false, label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", ...over,
});
const none = () => null;

describe("the matrix alone", () => {
  it("is every field, in section order, each with its scope and the matrix's own requirement", () => {
    // Every field of the Read Me worksheet is in the catalogue (353); the 238 provisions (x, not offered) are off.
    expect(BASE_CATALOGUE.fields).toHaveLength(353);
    expect(BASE_CATALOGUE.fields.filter((f) => f.status === "active")).toHaveLength(115);
    expect(BASE_CATALOGUE.sections).toHaveLength(38);
    expect(BASE_CATALOGUE.version).toBe(0);
    const rule = (k: string) => BASE_CATALOGUE.byKey.get(k)!.requirementRule;
    const scopes = Object.fromEntries(FIELD_SCOPES.map((s) => [s, activeFields(BASE_CATALOGUE, s).length]));
    expect(scopes).toEqual({ voucher: 53, ledger: 9, item: 35, allocation: 12, additionalCost: 3 }); // 112 a new order carries
    // The three "Update" fields belong to pre-closing an existing order: never a new order's, never imported.
    expect(preCloseFields(BASE_CATALOGUE).map((f) => [f.key, f.scope, f.inImport, f.requirementRule.kind])).toEqual([
      ["preCloseQuantity", "allocation", false, "always"],
      ["preCloseReason", "allocation", false, "always"],
      ["preCloseDate", "allocation", false, "always"],
    ]);
    expect(importFields(BASE_CATALOGUE).some((f) => f.workflow)).toBe(false);
    expect(formFields(BASE_CATALOGUE, "allocation").some((f) => f.workflow)).toBe(false);
    // The x fields the WMS offers are optional and stored by key, like a custom field.
    expect(rule("portOfLoading")).toEqual({ kind: "never" });
    expect(storedPath(BASE_CATALOGUE.byKey.get("cessRate")!)).toBe("custom.cessRate");
    expect(storedPath(BASE_CATALOGUE.byKey.get("hsnDescription")!)).toBe("hsn.description");
    expect(rule("carrier")).toEqual({ kind: "always" });
    expect(rule("igstRate")).toEqual({ kind: "when", condition: { op: "in", field: "gstRateDetails", values: ["Specify Details Here"] } });
    expect(rule("consigneeGstin")).toEqual({ kind: "never" }); // the approved exception
    // The current Read Me: Is Bill of Entry available is Y; GST Taxability Type is Y under "Specify Details Here";
    // GST Classification (?) is required with "Use GST Classification"; HSN Description (x) is optional.
    expect(rule("buyerBillOfEntry")).toEqual({ kind: "always" });
    expect(rule("gstTaxability")).toEqual({ kind: "when", condition: { op: "in", field: "gstRateDetails", values: ["Specify Details Here"] } });
    expect(rule("gstClassification")).toEqual({ kind: "when", condition: { op: "in", field: "gstRateDetails", values: ["Use GST Classification"] } });
    expect(rule("hsnDescription")).toEqual({ kind: "never" });
    expect(rule("originalSalesNature")).toEqual({ kind: "never" }); // the approved decision
    expect(rule("discPct")).toEqual({ kind: "never" });
    expect([...LOCKED_FIELD_KEYS].every((k) => BASE_CATALOGUE.byKey.get(k)!.locked)).toBe(true);
  });
});

describe("settings over the matrix", () => {
  it("change label, section, order, requirement and availability; a retired field leaves the form and import", () => {
    const c = buildCatalogue(
      [
        setting({ fieldKey: "carrier", scope: "voucher", label: "Transporter", requirement: "optional", displayOrder: 1 }),
        setting({ fieldKey: "mrp", scope: "item", status: "retired" }),
        setting({ fieldKey: "ledgerRate", scope: "ledger", requirement: "conditional", condition: { op: "ledgerKind", values: ["other"] } }),
        setting({ fieldKey: "changeMode", scope: "voucher", options: ["Item Invoice", "As Voucher", "Not a Tally value"] }),
      ],
      7,
    );
    const f = (k: string) => c.byKey.get(k)!;
    expect(c.version).toBe(7);
    expect([f("carrier").label, f("carrier").tallyName, f("carrier").requirementRule]).toEqual(["Transporter", "Carrier Name/Agent", { kind: "never" }]);
    expect(f("mrp").status).toBe("retired");
    expect(formFields(c, "item").some((x) => x.key === "mrp")).toBe(false);
    expect(importFields(c).some((x) => x.key === "mrp")).toBe(false);
    // The customer's own ledger entry no longer needs a rate; the others still do.
    expect(isRequired(f("ledgerRate"), none, "customer")).toBe(false);
    expect(isRequired(f("ledgerRate"), none, "other")).toBe(true);
    // Allowed values narrow to Tally's own: an unknown one is dropped, never added.
    expect(f("changeMode").options).toEqual(["As Voucher", "Item Invoice"]);
    expect(describeRule(f("ledgerRate").requirementRule, c)).toBe("Mandatory on ledger entries other than the customer's");
  });

  it("a locked field keeps its requirement, availability and status whatever a stored row says; only label and order apply", () => {
    const c = buildCatalogue([setting({ fieldKey: "rate", scope: "item", label: "Unit price", displayOrder: 5, requirement: "optional", inImport: false, status: "retired" })]);
    const rate = c.byKey.get("rate")!;
    expect([rate.label, rate.displayOrder, rate.requirementRule, rate.inImport, rate.status]).toEqual(["Unit price", 5, { kind: "always" }, true, "active"]);
  });

  it("custom fields at every scope join the catalogue, with their own heading, type and rule", () => {
    const custom = (scope: FieldScope, n: number) => setting({ fieldKey: `custom_f${n}`, isCustom: true, scope, label: `Custom ${scope}`, section: "Extra", fieldType: n === 1 ? "choice" : "text", options: n === 1 ? ["A", "B"] : null, requirement: n === 2 ? "mandatory" : null });
    const c = buildCatalogue(FIELD_SCOPES.map((s, i) => custom(s, i + 1)));
    for (const s of FIELD_SCOPES) expect(activeFields(c, s).some((f) => f.isCustom && f.label === `Custom ${s}`), s).toBe(true);
    expect(c.byKey.get("custom_f1")).toMatchObject({ scope: "voucher", type: "choice", options: ["A", "B"], tallyName: "Custom voucher", requirementRule: { kind: "never" } });
    expect(c.byKey.get("custom_f2")!.requirementRule).toEqual({ kind: "always" });
    expect(c.sections.at(-1)).toBe("Extra");
    expect(customKey("Project Code", c)).toBe("custom_project_code");
  });
});

describe("the condition vocabulary", () => {
  it("in, notIn, given and ledgerKind, case-insensitively; anything else is not a condition", () => {
    const v = (x: string | null) => () => x;
    expect(conditionHolds({ op: "in", field: "a", values: ["Regular"] }, v("regular"))).toBe(true);
    expect(conditionHolds({ op: "in", field: "a", values: ["Regular"] }, v(""))).toBe(false);
    expect(conditionHolds({ op: "notIn", field: "a", values: ["Unknown"] }, v("Regular"))).toBe(true);
    expect(conditionHolds({ op: "given", field: "a" }, v("x"))).toBe(true);
    expect(conditionHolds({ op: "ledgerKind", values: ["customer"] }, v(null), "other")).toBe(false);
    expect(isCondition({ op: "in", field: "x", values: ["a"] })).toBe(true);
    for (const bad of [{ op: "eval", code: "1" }, { op: "in", field: 1, values: [] }, "x", null, { op: "ledgerKind", values: ["boss"] }]) expect(isCondition(bad)).toBe(false);
  });
});

describe("validating a setting", () => {
  const c = BASE_CATALOGUE;
  it("a locked field: label and order only", () => {
    expect(validateSetting(input({ fieldKey: "documentNo", scope: "voucher", label: "SO No.", displayOrder: 3 }), c)).toEqual([]);
    expect(validateSetting(input({ fieldKey: "documentNo", scope: "voucher", requirement: "optional" }), c).join(" ")).toMatch(/locked: its requirement/);
    expect(validateSetting(input({ fieldKey: "itemName", scope: "item", status: "retired" }), c).join(" ")).toMatch(/locked: it can't be hidden/);
    expect(validateSetting(input({ fieldKey: "amount", scope: "ledger", section: "Item Details" }), c).join(" ")).toMatch(/locked: only its label/);
  });

  it("refuses a scope change, a type on a matrix field, values Tally doesn't have, and a mandatory field missing from the form or import", () => {
    expect(validateSetting(input({ fieldKey: "carrier", scope: "item" }), c)).toContain("A matrix field's scope can't be changed.");
    expect(validateSetting(input({ fieldKey: "carrier", scope: "voucher", fieldType: "number" }), c).join(" ")).toMatch(/type comes from Tally/);
    expect(validateSetting(input({ fieldKey: "changeMode", scope: "voucher", options: ["Barter"] }), c).join(" ")).toMatch(/Not one of Change Mode's Tally values: Barter/);
    expect(validateSetting(input({ fieldKey: "carrier", scope: "voucher", inImport: false }), c).join(" ")).toMatch(/must be available on both the form and the import/);
    expect(validateSetting(input({ fieldKey: "carrier", scope: "voucher", requirement: "optional", inImport: false }), c)).toEqual([]);
  });

  it("conditions: only from the vocabulary, on an active field of the same scope or the order, never on itself", () => {
    const cond = (condition: SettingInput["condition"], scope: FieldScope = "item", fieldKey = "mrp") => validateSetting(input({ fieldKey, scope, requirement: "conditional", condition }), c).join(" ");
    expect(cond({ op: "in", field: "gstRateDetails", values: ["Specify Details Here"] })).toBe("");
    expect(cond({ op: "in", field: "buyerRegType", values: ["Regular"] })).toBe(""); // the order's field
    expect(cond({ op: "in", field: "gstRateDetails", values: ["Sometimes"] })).toMatch(/must be values of GST Rate Details/);
    expect(cond({ op: "given", field: "allocOrderNo" })).toMatch(/same product line or of the order/);
    expect(cond({ op: "given", field: "mrp" })).toMatch(/can't depend on itself/);
    expect(cond({ op: "given", field: "nothing" })).toMatch(/doesn't exist/);
    expect(cond({ op: "ledgerKind", values: ["customer"] })).toMatch(/ledger-entry fields only/);
    expect(cond(null)).toMatch(/needs its condition/);
  });

  it("custom fields: a label that's no other field's name, a type, values for a choice; a field others depend on can't retire", () => {
    const custom = (over: Partial<SettingInput>) => validateSetting(input({ isCustom: true, scope: "allocation", label: "Batch Ref", section: "Item Allocations Details", fieldType: "text", ...over }), c).join(" ");
    expect(custom({})).toBe("");
    expect(custom({ label: "Item Name" })).toMatch(/already the name of the field Item Name/);
    expect(custom({ fieldType: "choice", options: [] })).toMatch(/needs at least one value/);
    expect(custom({ fieldType: null })).toMatch(/Choose the custom field's type/);
    expect(validateSetting(input({ fieldKey: "gstRateDetails", scope: "item", status: "retired", requirement: "optional" }), c).join(" ")).toMatch(/can't be retired: .*IGST Rate/);
  });
});

describe("the pre-close fields (the Read Me's “Update” fields) in the configuration", () => {
  const pre = (over: Partial<SettingInput>) => validateSetting(input({ scope: "allocation", inImport: false, ...over }), BASE_CATALOGUE);
  it("may be relabelled and reordered, and the reason made optional; nothing else", () => {
    expect(pre({ fieldKey: "preCloseReason", label: "Why", displayOrder: 5, requirement: "optional" })).toEqual([]);
    expect(pre({ fieldKey: "preCloseQuantity", label: "Qty to close" })).toEqual([]);
    expect(pre({ fieldKey: "preCloseQuantity", requirement: "optional" }).join(" ")).toMatch(/locked/);
    expect(pre({ fieldKey: "preCloseDate", requirement: "optional" }).join(" ")).toMatch(/locked/);
    expect(pre({ fieldKey: "preCloseReason", requirement: "conditional", condition: { op: "given", field: "dueDate" } }).join(" ")).toMatch(/never conditional/);
    expect(pre({ fieldKey: "preCloseReason", section: "Somewhere else" }).join(" ")).toMatch(/section can't change/);
    expect(pre({ fieldKey: "preCloseReason", inForm: false }).join(" ")).toMatch(/can't be hidden or retired/);
    expect(pre({ fieldKey: "preCloseReason", status: "retired" }).join(" ")).toMatch(/can't be hidden or retired/);
    expect(pre({ fieldKey: "preCloseReason", scope: "item" }).join(" ")).toMatch(/scope can't be changed/);
  });
  it("an x field the WMS offers is configured like any optional matrix field", () => {
    expect(validateSetting(input({ fieldKey: "portOfLoading", scope: "voucher", requirement: "mandatory" }), BASE_CATALOGUE)).toEqual([]);
    expect(validateSetting(input({ fieldKey: "portOfLoading", scope: "voucher", inForm: false, inImport: false }), BASE_CATALOGUE)).toEqual([]);
    const c = buildCatalogue([setting({ fieldKey: "portOfLoading", scope: "voucher", requirement: "mandatory" })]);
    expect(isRequired(c.byKey.get("portOfLoading")!, none)).toBe(true);
  });
});
