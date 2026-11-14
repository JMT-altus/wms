import { describe, expect, it } from "vitest";
import { planRows, type DocumentRecord, type RawRow } from "@/lib/tally/plan";
import { checkMapping, mappingIsUsable, suggestMapping } from "@/lib/tally/mapping";
import { salesOrderMappingFields } from "@/lib/tally/categories";
import { buildCatalogue, importFields, type FieldScope, type FieldSetting, type SoCatalogue } from "@/lib/tally/sales-order-config";
import { salesOrderTemplateSheets, templateHeadings, templateRow } from "@/lib/tally/sales-order-template";
import { orderDifferences } from "@/lib/tally/sales-order-compare";
import { soEntry, soLine, soVoucher, type SoCells } from "../fixtures/sales-order-rows";

// The Sales Order import under an administrator's field configuration: requirements, conditions, retired fields and
// custom fields at every scope drive the mapping, the planner, the template and the comparison. All data is invented.
const today = "2026-10-31";
const setting = (over: Partial<FieldSetting> & Pick<FieldSetting, "fieldKey" | "scope">): FieldSetting => ({
  isCustom: false, label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", rowVersion: 1, ...over,
});
const custom = (key: string, scope: FieldScope, over: Partial<FieldSetting> = {}) => setting({ fieldKey: key, scope, isCustom: true, label: `X ${scope}`, section: "Extra", fieldType: "text", ...over });

function planner(c: SoCatalogue) {
  const mapping = Object.fromEntries(importFields(c).map((f, i) => [f.key, i]));
  const head = (over: SoCells = {}, no = "SO/1") => templateRow(c, { documentDate: "01-04-2026", documentNo: no, partyName: "Alpha Traders", amount: "1000", drCr: "Dr", ...soVoucher("Alpha Traders"), ...soEntry, orderDate: "01-04-2026", ...over });
  const item = (over: SoCells = {}) => templateRow(c, { partyName: "Sales", amount: "1000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: "1000", lineAmount: "1000", ...soLine("1000"), ...over });
  const plan = (...r: string[][]) => planRows("sales-orders", r.map((cells, i): RawRow => ({ rowNo: i + 2, cells })), mapping, { asOfDate: null, direction: null, today, soCatalogue: c });
  return { head, item, plan, mapping };
}
const all = (p: ReturnType<ReturnType<typeof planner>["plan"]>) => p.rows.flatMap((r) => r.messages).join(" | ");

describe("requirements follow the configuration", () => {
  it("a matrix field made optional may be blank; one made mandatory is required; a retired field's column is not read", () => {
    const c = buildCatalogue([setting({ fieldKey: "carrier", scope: "voucher", requirement: "optional" }), setting({ fieldKey: "priceLevel", scope: "voucher", requirement: "mandatory" }), setting({ fieldKey: "mrp", scope: "item", status: "retired" })]);
    const { head, item, plan } = planner(c);
    expect(all(plan(head({ carrier: "", priceLevel: "Retail" }), item()))).toBe("");
    expect(all(plan(head({ priceLevel: "" }), item()))).toMatch(/“Price Level”/);
    expect(templateHeadings(c)).not.toContain("MRP/Marginal");
  });

  it("the customer's ledger entry can be freed from Ledger Rate / Narration / Description while the other entries keep them", () => {
    const others = { requirement: "conditional" as const, condition: { op: "ledgerKind" as const, values: ["other" as const] } };
    const c = buildCatalogue(["ledgerRate", "ledgerNarration", "ledgerDescription"].map((k) => setting({ fieldKey: k, scope: "ledger", ...others })));
    const { head, item, plan } = planner(c);
    expect(all(plan(head({ ledgerRate: "", ledgerNarration: "", ledgerDescription: "" }), item()))).toBe("");
    expect(all(plan(head(), item({ ledgerNarration: "" })))).toMatch(/“Ledger Narration” is required for ledger "Sales"/);
  });

  it("a condition on the order: GSTIN-style rules can be given to any field", () => {
    const c = buildCatalogue([setting({ fieldKey: "otherReferences", scope: "voucher", requirement: "conditional", condition: { op: "in", field: "buyerRegType", values: ["Regular"] } })]);
    const { head, item, plan } = planner(c);
    expect(all(plan(head({ otherReferences: "" }), item()))).toBe(""); // an unregistered buyer
    expect(all(plan(head({ otherReferences: "", buyerRegType: "Regular", gstin: "27ABCDE1234F1Z5" }), item()))).toMatch(/“Other References”/);
  });

  it("Order Due on made optional: an allocation without a date is stored with none", () => {
    const c = buildCatalogue([setting({ fieldKey: "dueDate", scope: "allocation", requirement: "optional" })]);
    const { head, item, plan } = planner(c);
    const p = plan(head(), item({ dueDate: "" }));
    expect(all(p)).toBe("");
    expect((p.records[0] as DocumentRecord).lines[0]!.allocations![0]!.dueDate).toBeNull();
  });
});

describe("custom fields at every scope", () => {
  const c = buildCatalogue([
    custom("custom_project", "voucher", { label: "Project", requirement: "mandatory" }),
    custom("custom_cost_head", "ledger", { label: "Cost Head", fieldType: "choice", options: ["Direct", "Indirect"] }),
    custom("custom_drawing", "item", { label: "Drawing No", requirement: "conditional", condition: { op: "in", field: "gstRateDetails", values: ["Specify Details Here"] } }),
    custom("custom_batch", "allocation", { label: "Batch Ref" }),
    custom("custom_note", "additionalCost", { label: "Cost Note", requirement: "mandatory" }),
  ]);
  const { head, item, plan, mapping } = planner(c);

  it("are headings of the template and map themselves; a mandatory one must have its column", () => {
    const headings = templateHeadings(c);
    for (const h of ["Project", "Cost Head", "Drawing No", "Batch Ref", "Cost Note"]) expect(headings).toContain(h);
    const fields = salesOrderMappingFields(c);
    expect(suggestMapping("sales-orders", headings, [], null, fields)).toEqual(mapping);
    expect(mappingIsUsable(checkMapping("sales-orders", mapping, headings, [], fields))).toBe(true);
    const { custom_project: _p, ...withoutProject } = mapping;
    expect(checkMapping("sales-orders", withoutProject, headings, [], fields).missingRequired.map((f) => f.label)).toEqual(["Project"]);
    const readMe = salesOrderTemplateSheets(c)[2]!.rows;
    expect(readMe.find((r) => r[0] === "Drawing No")).toEqual(["Drawing No", "Extra", "Mandatory when GST Rate Details is “Specify Details Here”", "Custom field (Product line)."]);
  });

  it("are validated and stored with the order, the ledger entry, the line, the allocation and the additional cost", () => {
    const p = plan(
      head({ custom_project: "Plant 2", custom_cost_head: "direct" }),
      item({ custom_batch: "B-7" }),
      templateRow(c, { addlCostLedger: "Freight Inward", addlCostAmount: "50", custom_note: "Road" }),
    );
    expect(all(p)).toBe("");
    const d = p.records[0] as DocumentRecord;
    expect(d.details!.custom).toEqual({ custom_project: "Plant 2" });
    expect(d.details!.ledgers[0]!.custom).toEqual({ custom_cost_head: "Direct" }); // spelled as its list has it
    expect(d.lines[0]!.allocations![0]!.custom).toEqual({ custom_batch: "B-7" });
    expect(d.details!.additionalCosts[0]!.custom).toEqual({ custom_note: "Road" });
  });

  it("their rules hold: a mandatory one blank, a conditional one when its condition holds, a choice off its list", () => {
    expect(all(plan(head(), item()))).toMatch(/“Project”/);
    expect(all(plan(head({ custom_project: "P" }), item({ gstRateDetails: "Specify Details Here", gstTaxability: "Taxable", igstRate: "18", cgstRate: "9", sgstRate: "9" })))).toMatch(/blank on this product line: “Drawing No”/);
    expect(all(plan(head({ custom_project: "P", custom_cost_head: "Other" }), item()))).toMatch(/“Cost Head” "Other" isn't one of: Direct, Indirect/);
    expect(all(plan(head({ custom_project: "P" }), item(), templateRow(c, { addlCostLedger: "Freight", addlCostAmount: "5" })))).toMatch(/blank on this additional cost: “Cost Note”/);
    expect(all(plan(head({ custom_project: "P" }), item({ custom_drawing: "D-1" })))).toBe("");
    expect((plan(head({ custom_project: "P" }), item({ custom_drawing: "D-1" })).records[0] as DocumentRecord).lines[0]!.custom).toEqual({ custom_drawing: "D-1" });
  });

  it("a change to a custom value at any scope is a changed version, never a duplicate", () => {
    const v1 = plan(head({ custom_project: "P", custom_cost_head: "Direct" }), item({ custom_batch: "B-1" })).records[0] as DocumentRecord;
    const v2 = plan(head({ custom_project: "P", custom_cost_head: "Indirect" }), item({ custom_batch: "B-2" })).records[0] as DocumentRecord;
    const labels = orderDifferences(v1, v2).map((d) => d.label);
    expect(labels).toEqual(expect.arrayContaining(['Ledger "Alpha Traders" · custom_cost_head', 'Item "Gear Motor" · allocations']));
    expect(orderDifferences(v1, v1)).toEqual([]);
  });

  it("a retired custom field: its column is no longer read, and orders already holding a value keep it", () => {
    const stored = plan(head({ custom_project: "Kept" }), item()).records[0] as DocumentRecord;
    const retired = buildCatalogue([custom("custom_project", "voucher", { label: "Project", status: "retired" })]);
    expect(templateHeadings(retired)).not.toContain("Project");
    expect(stored.details!.custom).toEqual({ custom_project: "Kept" }); // nothing about retiring touches what is stored
    expect(retired.byKey.get("custom_project")).toMatchObject({ status: "retired", label: "Project" }); // its definition stays, for display
  });
});
