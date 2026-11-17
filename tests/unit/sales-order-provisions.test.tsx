// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 60_000 });

// The COMPLETE Sales Order field catalogue: every field and section of the Read Me worksheet (tests/fixtures/
// sales-order-read-me.ts), the provisions (the 238 x fields off by default), section settings, help text, and Admin &
// Master Setup → Sales Order Fields over all of it. The server actions are MOCKED; all data is invented.
const a = vi.hoisted(() => ({ save: vi.fn(), saveSection: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh, push: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: a.toast }));
vi.mock("@/app/(masters)/master-setup/sales-order-fields/actions", () => ({ saveSalesOrderField: (...x: unknown[]) => a.save(...x), saveSalesOrderSection: (...x: unknown[]) => a.saveSection(...x) }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ options, value, onValueChange, ariaLabel }: { options: { value: string; label: string }[]; value: string; onValueChange: (v: string) => void; ariaLabel?: string }) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Choose…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

import { SalesOrderFieldsManager } from "@/components/admin/master/sales-order-fields-manager";
import { SalesOrderEntryForm } from "@/components/forms/tally/sales-order-entry-form";
import { SalesOrderDetailsView } from "@/components/forms/tally/sales-order-details";
import { suggestMapping } from "@/lib/tally/mapping";
import { planRows, type DocumentRecord, type RawRow } from "@/lib/tally/plan";
import { salesOrderMappingFields } from "@/lib/tally/categories";
import { SO_EMPTY_SECTIONS, SO_FIELDS, SO_PROVISIONS, SO_SECTIONS, ignoredHeadingReason, soMarking } from "@/lib/tally/sales-order-catalogue";
import { orderDifferences } from "@/lib/tally/sales-order-compare";
import {
  BASE_CATALOGUE,
  FIELD_SCOPES,
  LOCKED_FIELD_KEYS,
  SECTION_KEY_PREFIX,
  baseRule,
  buildCatalogue,
  formFields,
  ignoredHeading,
  importFields,
  isRequired,
  scopeOfLevel,
  sectionKey,
  sectionLabel,
  supportOf,
  validateSection,
  validateSetting,
  type FieldSetting,
  type SectionInput,
  type SettingInput,
  type SoCatalogue,
} from "@/lib/tally/sales-order-config";
import { salesOrderFormRows, type SoFormOrder } from "@/lib/tally/sales-order-form";
import { SO_TEMPLATE_HEADINGS, salesOrderTemplateSheets, templateHeadings, templateRow } from "@/lib/tally/sales-order-template";
import { READ_ME } from "../fixtures/sales-order-read-me";
import { soEntry, soLine, soVoucher, type SoCells } from "../fixtures/sales-order-rows";

const today = "2026-10-31";
const setting = (over: Partial<FieldSetting> & Pick<FieldSetting, "fieldKey" | "scope">): FieldSetting => ({
  isCustom: false, label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", rowVersion: 1, ...over,
});
/** A provision switched on, as its settings row would be. */
const on = (key: string, over: Partial<FieldSetting> = {}) => setting({ fieldKey: key, scope: scopeOfLevel(SO_FIELDS.find((f) => f.key === key)!.level), ...over });
/** A section's settings row. */
const sectionRow = (name: string, over: Partial<FieldSetting> = {}) => setting({ fieldKey: sectionKey(name), scope: "voucher", section: name, ...over });
const input = (over: Partial<SettingInput> & Pick<SettingInput, "scope">): SettingInput => ({
  fieldKey: null, isCustom: false, label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", ...over,
});
const sectionInput = (over: Partial<SectionInput> & Pick<SectionInput, "name">): SectionInput => ({ isNew: false, label: null, displayOrder: null, status: "active", ...over });
const byName = new Map(SO_FIELDS.map((f) => [f.tallyName, f]));

/** An order in a configuration's own template layout, planned under it. */
function planOrder(c: SoCatalogue, over: { head?: SoCells; item?: SoCells; more?: SoCells[] } = {}) {
  const head = templateRow(c, { documentDate: "01-04-2026", documentNo: "SO/P/1", partyName: "Alpha Traders", amount: "1000", drCr: "Dr", ...soVoucher("Alpha Traders"), ...soEntry, orderDate: "01-04-2026", ...over.head });
  const item = templateRow(c, { partyName: "Sales", amount: "1000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: "1000", lineAmount: "1000", ...soLine("1000"), ...over.item });
  const rows: RawRow[] = [head, item, ...(over.more ?? []).map((cells) => templateRow(c, cells))].map((cells, i) => ({ rowNo: i + 2, cells }));
  const mapping = Object.fromEntries(importFields(c).map((f, i) => [f.key, i]));
  return planRows("sales-orders", rows, mapping, { asOfDate: null, direction: null, today, soCatalogue: c });
}
const messages = (p: ReturnType<typeof planOrder>) => p.rows.flatMap((r) => r.messages).join(" | ");
const doc = (p: ReturnType<typeof planOrder>) => p.records[0] as DocumentRecord;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the catalogue holds every field and section of the Read Me worksheet", () => {
  it("353 fields in 38 sections: each once, with the worksheet's own name, row, section and marking", () => {
    expect(READ_ME).toHaveLength(353);
    expect(SO_FIELDS).toHaveLength(353);
    for (const [row, section, name, marking] of READ_ME) {
      const f = byName.get(name);
      expect(f, `${name} (row ${row}) has a catalogue entry`).toBeTruthy();
      expect([f!.matrixRow, f!.section, soMarking(f!)], name).toEqual([row, section, marking]);
    }
    const count = (m: string) => READ_ME.filter((r) => r[3] === m).length;
    expect([count("Y"), count("?"), count("Provision"), count("x"), count("Update")]).toEqual([65, 18, 8, 259, 3]);
    // The sections, in the worksheet's own order, none missing and none invented.
    const sheetSections = [...new Set(READ_ME.map((r) => r[1]))];
    expect(sheetSections).toHaveLength(38);
    expect([...SO_SECTIONS]).toEqual(sheetSections);
    // 22 sections are marked x throughout. The WMS offers five fields of one of them (Export/Import Details); the
    // other 21 are the sections that used to be absent from Admin & Master Setup altogether.
    const allX = sheetSections.filter((s) => READ_ME.filter((r) => r[1] === s).every((r) => r[3] === "x"));
    expect([...SO_EMPTY_SECTIONS, "Export/Import Details"].sort()).toEqual([...allX].sort());
    expect(SO_EMPTY_SECTIONS).toHaveLength(21);
    for (const s of SO_EMPTY_SECTIONS) expect(BASE_CATALOGUE.fields.filter((f) => f.section === s).every((f) => f.defaultOff), s).toBe(true);
  });

  it("every field has a key the settings table accepts, unique, and never a custom field's or a section's", () => {
    const keys = SO_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(353);
    for (const k of keys) {
      expect(k, k).toMatch(/^[a-z][A-Za-z0-9_]{1,62}$/);
      expect(k.startsWith("custom_") || k.startsWith(SECTION_KEY_PREFIX), k).toBe(false);
    }
    // The 38 sections' own settings keys are unique and valid too.
    const sectionKeys = SO_SECTIONS.map((s) => sectionKey(s));
    expect(new Set(sectionKeys).size).toBe(38);
    for (const k of sectionKeys) expect(k, k).toMatch(/^section_[a-z0-9_]{1,55}$/);
  });

  it("every field is in Admin & Master Setup's configuration, in its own section, with its marking, scope and type", () => {
    expect(BASE_CATALOGUE.fields).toHaveLength(353);
    expect(BASE_CATALOGUE.sectionList.map((s) => s.name)).toEqual([...SO_SECTIONS]);
    for (const [, section, name, marking] of READ_ME) {
      const f = BASE_CATALOGUE.byKey.get(byName.get(name)!.key)!;
      expect([f.section, f.marking, f.isCustom], name).toEqual([section, marking, false]);
      expect(FIELD_SCOPES, name).toContain(f.scope);
      expect(["text", "date", "amount", "number", "percent", "yesno", "choice", "gstin", "state", "pincode", "hsn"], name).toContain(f.type);
      if (f.type === "choice" || f.type === "yesno") expect(f.options?.length, name).toBeGreaterThan(0);
    }
    // Every section holds exactly the worksheet's fields for it.
    for (const s of SO_SECTIONS) expect(BASE_CATALOGUE.fields.filter((f) => f.section === s).map((f) => f.tallyName).sort(), s).toEqual(READ_ME.filter((r) => r[1] === s).map((r) => r[2]).sort());
  });

  it("the mandatory rules are the approved ones: Y is required (always, under its condition, or by its approved exception); nothing else is, but GST Classification", () => {
    for (const [, , name, marking] of READ_ME) {
      const f = byName.get(name)!;
      const rule = baseRule(f);
      if (marking === "Y") {
        if (f.notEnforced) expect(rule, name).toEqual({ kind: "never" });
        else if (f.mandatoryWhen) expect(rule.kind, name).toBe("when");
        else expect(rule, name).toEqual({ kind: "always" });
      } else if (marking === "Update") expect(rule, name).toEqual({ kind: "always" });
      else if (name === "GST Classification") expect(rule.kind, name).toBe("when");
      else expect(rule, name).toEqual({ kind: "never" });
    }
    // The one approved exception among the Y fields, and the only "?" the business requires in a case.
    expect(SO_FIELDS.filter((f) => f.notEnforced).map((f) => f.tallyName)).toEqual(["Consignee - GSTIN/UIN"]);
    expect(SO_FIELDS.filter((f) => f.requirement !== "mandatory" && f.mandatoryWhen).map((f) => f.tallyName)).toEqual(["GST Classification"]);
    // No provision is ever required by the matrix.
    expect(SO_PROVISIONS.every((f) => baseRule(f).kind === "never")).toBe(true);
  });

  it("on by default: the 91 applied fields, the 21 x fields offered and the 3 Update fields; the 238 provisions are off", () => {
    const active = BASE_CATALOGUE.fields.filter((f) => f.status === "active");
    expect(active).toHaveLength(115);
    expect(active.some((f) => f.defaultOff)).toBe(false);
    expect(SO_PROVISIONS).toHaveLength(238);
    expect(SO_PROVISIONS.every((f) => f.keyed && f.outsideMatrix && f.xVerdict && soMarking(f) === "x")).toBe(true);
    for (const f of SO_PROVISIONS) expect(BASE_CATALOGUE.byKey.get(f.key), f.tallyName).toMatchObject({ status: "retired", ownStatus: "retired", sectionOff: false });
    // So today's template, mapping and form are exactly what they were: 112 columns, no provision among them.
    expect(templateHeadings(BASE_CATALOGUE)).toEqual([...SO_TEMPLATE_HEADINGS]);
    expect(templateHeadings(BASE_CATALOGUE)).toHaveLength(112);
    expect(salesOrderMappingFields(BASE_CATALOGUE)).toHaveLength(112);
    expect(FIELD_SCOPES.flatMap((s) => formFields(BASE_CATALOGUE, s)).some((f) => f.defaultOff)).toBe(false);
    expect(salesOrderTemplateSheets()[0]!.rows[0]).toHaveLength(112);
  });

  it("every field's setting can be saved and read back: a label on each, and its original marking stays", () => {
    for (const f of SO_FIELDS) {
      const scope = scopeOfLevel(f.level);
      const own = BASE_CATALOGUE.byKey.get(f.key)!.ownStatus;
      // What the screen sends for a label change: everything else as the field has it.
      const errors = validateSetting(input({ fieldKey: f.key, scope, label: `${f.tallyName} (renamed)`.slice(0, 120), status: own, inImport: !f.workflow }), BASE_CATALOGUE);
      expect(errors, f.tallyName).toEqual([]);
    }
    const c = buildCatalogue(SO_FIELDS.map((f) => setting({ fieldKey: f.key, scope: scopeOfLevel(f.level), label: `L ${f.matrixRow}`, status: BASE_CATALOGUE.byKey.get(f.key)!.ownStatus })));
    for (const f of SO_FIELDS) expect(c.byKey.get(f.key), f.tallyName).toMatchObject({ label: `L ${f.matrixRow}`, tallyName: f.tallyName, marking: soMarking(f), section: f.section });
  });
});

describe("the provisions: x fields off by default", () => {
  it("each says how far the WMS supports it: 25 fully, 213 as recorded values only, none blocked", () => {
    const n = (k: string) => SO_PROVISIONS.filter((f) => supportOf(f) === k).length;
    expect([n("full"), n("recordOnly"), n("needsWork")]).toEqual([25, 213, 0]);
    for (const f of SO_PROVISIONS.filter((p) => p.dependency)) expect(f.dependency!.text.length, f.tallyName).toBeGreaterThan(40);
    const names = (k: string) => new Set(SO_PROVISIONS.filter((f) => supportOf(f) === k).map((f) => f.section));
    expect(names("recordOnly").has("e-Way Bill Details") && names("recordOnly").has("e-Invoice Details") && names("recordOnly").has("Bill Allocations")).toBe(true);
    expect(supportOf(byName.get("Motor Vehicle No.")!)).toBe("full");
    expect(supportOf(byName.get("Discount Rate (Cash/Trade)")!)).toBe("full"); // worked into the line amount
    expect(byName.get("e-Invoice - IRN")!.dependency).toMatchObject({ kind: "recordOnly", text: expect.stringMatching(/Record only.*e-Invoice portal/) });
    expect(byName.get("Item Allocations - Godown Name")!.dependency).toMatchObject({ kind: "recordOnly", text: expect.stringMatching(/not checked against a godown/) });
    expect(byName.get("Bill Name")!.dependency).toMatchObject({ kind: "recordOnly", text: expect.stringMatching(/one row per bill reference\. No bill-wise receivable/) });
    // Nothing the WMS has on by default depends on anything.
    expect(SO_FIELDS.filter((f) => !f.defaultOff && f.dependency)).toEqual([]);
  });

  it("every provision can be enabled; a blocked field (should one ever be marked so again) is refused, with why", () => {
    for (const f of SO_PROVISIONS) expect(validateSetting(input({ fieldKey: f.key, scope: scopeOfLevel(f.level), status: "active" }), BASE_CATALOGUE), f.tallyName).toEqual([]);
    const c = buildCatalogue([on("billName", { label: "Bill reference" }), on("cashTradeDiscRate")]);
    expect(c.byKey.get("billName")).toMatchObject({ label: "Bill reference", status: "active" });
    expect(importFields(c).filter((f) => f.key === "billName" || f.key === "cashTradeDiscRate")).toHaveLength(2);
  });

  it("while it is off, its column in a file is recognised and ignored, saying how to switch it on", () => {
    expect(ignoredHeadingReason("Motor Vehicle No.")).toMatch(/not a Sales Order field .*after the order\. An administrator can enable it in Admin & Master Setup → Sales Order Fields\./);
    expect(ignoredHeadingReason("Bill Name")).toMatch(/An administrator can enable it/);
    expect(ignoredHeading(BASE_CATALOGUE, "motor vehicle no.")).toBe(ignoredHeadingReason("Motor Vehicle No."));
    expect(ignoredHeading(BASE_CATALOGUE, "Item Name")).toBeNull();
    expect(ignoredHeading(BASE_CATALOGUE, "Not a field at all")).toBeNull();
    const c = buildCatalogue([on("motorVehicleNo"), setting({ fieldKey: "priceLevel", scope: "voucher", status: "retired" }), setting({ fieldKey: "mrp", scope: "item", requirement: "optional", inImport: false })]);
    expect(ignoredHeading(c, "Motor Vehicle No.")).toBeNull(); // enabled: an import column now
    expect(ignoredHeading(c, "Price Level")).toMatch(/switched off for Sales Orders in Admin & Master Setup/);
    expect(ignoredHeading(c, "MRP/Marginal")).toMatch(/left out of imports/);
    expect(ignoredHeading(c, "Item Allocations - Pre-Close Date")).toMatch(/changes an existing order/);
  });

  const ENABLED = ["motorVehicleNo", "deliveryNoteDate", "ewayBillNo", "ewaySubType", "tdsNatureOfPayment", "tdsOverrideExemption", "allocBatchNo", "allocMfgDate", "allocGodown"];
  const enabled = () => buildCatalogue(ENABLED.map((k) => on(k)), 4);

  it("enabled, it is a column of the template and the mapping, in its own section, optional", () => {
    const c = enabled();
    const headings = templateHeadings(c);
    expect(headings).toHaveLength(112 + ENABLED.length);
    for (const k of ENABLED) expect(headings, k).toContain(c.byKey.get(k)!.tallyName);
    const fields = salesOrderMappingFields(c);
    expect(fields.find((f) => f.key === "ewayBillNo")).toMatchObject({ label: "e-Way Bill No.", section: "e-Way Bill Details", required: false, requirement: "provision" });
    expect(suggestMapping("sales-orders", headings, [], null, fields).motorVehicleNo).toBe(headings.indexOf("Motor Vehicle No."));
    // Under the matrix alone the same file's extra columns are not mapped to anything.
    expect(Object.values(suggestMapping("sales-orders", headings, []))).not.toContain(headings.indexOf("Motor Vehicle No."));
    // The template's Read Me lists it with what the WMS doesn't do for it.
    const readMe = salesOrderTemplateSheets(c)[2]!.rows;
    expect(readMe.find((r) => r[0] === "e-Way Bill No.")).toEqual(["e-Way Bill No.", "e-Way Bill Details", "Optional — marked x in the Read Me, enabled in Admin & Master Setup", expect.stringMatching(/Record only.*No e-Way Bill is generated/)]);
  });

  it("enabled, an order carrying it is valid and keeps each value with its order, ledger entry and delivery; its type is checked", () => {
    const c = enabled();
    const p = planOrder(c, {
      head: { motorVehicleNo: "MH12AB1234", deliveryNoteDate: "03-04-2026", ewayBillNo: "331001234567", ewaySubType: "supply", tdsNatureOfPayment: "194Q", tdsOverrideExemption: "no" },
      item: { allocBatchNo: "B-77", allocMfgDate: "01-03-2026", allocGodown: "Main" },
    });
    expect(messages(p)).toBe("");
    const d = doc(p);
    expect(d.details!.custom).toEqual({ motorVehicleNo: "MH12AB1234", deliveryNoteDate: "2026-04-03", ewayBillNo: "331001234567", ewaySubType: "Supply" });
    expect(d.details!.ledgers[0]!.custom).toEqual({ tdsNatureOfPayment: "194Q", tdsOverrideExemption: "No" });
    expect(d.lines[0]!.allocations![0]!.custom).toEqual({ allocBatchNo: "B-77", allocMfgDate: "2026-03-01", allocGodown: "Main" });
    // Recorded only: nothing about the order's amounts changes.
    expect([d.totalPaise, d.lines[0]!.amountPaise]).toEqual([100000, 100000]);
    expect(messages(planOrder(c, { head: { deliveryNoteDate: "31-02-2026" } }))).toMatch(/“Delivery Note Date\/Receipt Note Date\/Challan Date\/Tracking Date” "31-02-2026" can't be read as a date/);
    expect(messages(planOrder(c, { head: { ewaySubType: "Barter" } }))).toMatch(/“e-Way Bill - Sub-Type” "Barter" isn't one of: Not Applicable, Exhibition or Fairs/);
    expect(messages(planOrder(c, { head: { tdsOverrideExemption: "maybe" } }))).toMatch(/“Override TDS Exemption u\/s 206C” must be Yes or No/);
    // A ledger entry's field on a row with no ledger is refused, not dropped.
    expect(messages(planOrder(c, { more: [{ tdsNatureOfPayment: "194Q" }] }))).toMatch(/“TDS - Nature of Payments” belongs to a ledger entry, but this row has no ledger/);
    // Left blank it holds nothing back: it is optional unless an administrator says otherwise.
    expect(messages(planOrder(c))).toBe("");
    expect(doc(planOrder(c)).details!.custom).toBeUndefined();
  });

  it("enabled and made mandatory or conditional, the import enforces it", () => {
    const always = buildCatalogue([on("motorVehicleNo", { requirement: "mandatory" })]);
    expect(messages(planOrder(always))).toMatch(/Required field is blank: “Motor Vehicle No\.”/);
    expect(messages(planOrder(always, { head: { motorVehicleNo: "MH12AB1234" } }))).toBe("");
    expect(validateSetting(input({ fieldKey: "ewayBillNo", scope: "voucher", requirement: "conditional", condition: { op: "in", field: "dispatchedThrough", values: ["Road"] } }), BASE_CATALOGUE)).toEqual([]);
    const when = buildCatalogue([on("ewayBillNo", { requirement: "conditional", condition: { op: "in", field: "dispatchedThrough", values: ["Road"] } })]);
    expect(isRequired(when.byKey.get("ewayBillNo")!, (k) => (k === "dispatchedThrough" ? "road" : null))).toBe(true);
    expect(messages(planOrder(when))).toMatch(/“e-Way Bill No\.”/); // the fixture dispatches by Road
    expect(messages(planOrder(when, { head: { dispatchedThrough: "Air" } }))).toBe("");
  });

  it("enabled, it is part of the duplicate comparison and of the order page; disabled again, its stored value stays, marked retired", () => {
    const c = enabled();
    const cells = { head: { motorVehicleNo: "MH12AB1234", ewayBillNo: "331001234567" }, item: { allocBatchNo: "B-77" } };
    const base = doc(planOrder(c, cells));
    expect(orderDifferences(base, doc(planOrder(c, cells)))).toEqual([]);
    expect(orderDifferences(base, doc(planOrder(c, { ...cells, head: { ...cells.head, motorVehicleNo: "MH14ZZ0001" } }))).map((x) => x.label)).toEqual(["Motor Vehicle No."]);
    const { unmount } = render(<SalesOrderDetailsView details={base.details!} lines={base.lines} catalogue={c} />);
    const other = screen.getByText("Other Tally fields").closest("section, div")! as HTMLElement;
    expect(within(other).getByText("Motor Vehicle No.").nextSibling!.textContent).toBe("MH12AB1234");
    expect(within(other).getByText("e-Way Bill No.")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Allocations, GST and HSN/SAC" })).getByText(/Item Allocations - Batch\/Lot No\.: B-77/)).toBeTruthy();
    unmount();
    // Under the matrix alone (the provision off again) nothing stored is lost: it is shown, marked retired.
    render(<SalesOrderDetailsView details={base.details!} lines={base.lines} catalogue={BASE_CATALOGUE} />);
    expect(screen.getByText("Motor Vehicle No. (retired)").nextSibling!.textContent).toBe("MH12AB1234");
    expect(templateHeadings(BASE_CATALOGUE)).not.toContain("Motor Vehicle No.");
  });

  it("enabled, it has an input on the entry form at its own place, and what is typed reaches the import", () => {
    const c = enabled();
    const onCheck = vi.fn();
    const { container } = render(<SalesOrderEntryForm options={{ customers: [], products: [], ledgers: [] }} disabled={false} busy={false} problems={[]} onCheck={onCheck} loadCustomer={async () => null} catalogue={c} />);
    for (let round = 0; round < 4; round++) for (const b of [...container.querySelectorAll('button[aria-expanded="false"]')]) fireEvent.click(b);
    // Sections with no place of their own on the form appear under "Other Tally sections", by their own name.
    expect(screen.getByText("Other Tally sections")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^e-Way Bill Details — / })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Dispatch documents — / })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Motor Vehicle No. of the order"), { target: { value: "MH12AB1234" } });
    fireEvent.change(screen.getByLabelText("e-Way Bill No. of the order"), { target: { value: "331001234567" } });
    fireEvent.change(screen.getByLabelText("e-Way Bill - Sub-Type of the order"), { target: { value: "Supply" } });
    fireEvent.change(screen.getByLabelText("TDS - Nature of Payments of the customer ledger"), { target: { value: "194Q" } });
    fireEvent.change(screen.getByLabelText("Item Allocations - Batch/Lot No. of item 1 allocation 1"), { target: { value: "B-77" } });
    fireEvent.click(screen.getByRole("button", { name: /Check order/ }));
    const order = onCheck.mock.calls[0]![0] as SoFormOrder;
    expect([order.voucher.motorVehicleNo, order.voucher.ewayBillNo, order.voucher.ewaySubType]).toEqual(["MH12AB1234", "331001234567", "Supply"]);
    expect(order.party.custom).toEqual({ tdsNatureOfPayment: "194Q" });
    expect(order.items[0]!.allocations[0]!.allocBatchNo).toBe("B-77");
    // The rows the form makes carry them in the configuration's own columns.
    const built = salesOrderFormRows(order, c);
    const cell = (key: string, row = 0) => built.rows[row]!.cells[built.headers.indexOf(c.byKey.get(key)!.tallyName)];
    expect([cell("motorVehicleNo"), cell("ewayBillNo"), cell("tdsNatureOfPayment"), cell("allocBatchNo", 1)]).toEqual(["MH12AB1234", "331001234567", "194Q", "B-77"]);
    // Without the configuration none of it is on the form.
    cleanup();
    render(<SalesOrderEntryForm options={{ customers: [], products: [], ledgers: [] }} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={BASE_CATALOGUE} />);
    expect(screen.queryByText("Other Tally sections")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Dispatch documents — / })).toBeNull();
  });

  it("EVERY single-value provision — all 156 at once — is a template column, is imported, stored at its own scope, shown on the order page and has an input on the form", () => {
    // The other 82 — six repeating groups and the cash/trade discount — are rows or amounts: tests/unit/sales-order-groups.test.tsx.
    const able = SO_PROVISIONS.filter((f) => !f.group && !f.key.startsWith("cashTrade"));
    expect(able).toHaveLength(156);
    const c = buildCatalogue(able.map((f) => on(f.key)));
    expect(templateHeadings(c)).toHaveLength(112 + 156);
    // One valid value per field, by its type, and what the order must hold for it.
    const sample = (f: (typeof able)[number]): [typed: string, stored: string] =>
      f.type === "date" ? ["05-04-2026", "2026-04-05"] : f.type === "amount" ? ["12.5", "12.50"] : f.type === "number" ? ["3", "3"] : f.type === "percent" ? ["5", "5"] : f.type === "yesno" ? ["yes", "Yes"] : f.type === "choice" ? [f.options![0]!.toLowerCase(), f.options![0]!] : [`V ${f.matrixRow}`, `V ${f.matrixRow}`];
    const cells = (scope: string) => Object.fromEntries(able.filter((f) => scopeOfLevel(f.level) === scope).map((f) => [f.key, sample(f)[0]]));
    const expected = (scope: string) => Object.fromEntries(able.filter((f) => scopeOfLevel(f.level) === scope).map((f) => [f.key, sample(f)[1]]));
    expect([Object.keys(cells("voucher")).length, Object.keys(cells("ledger")).length, Object.keys(cells("allocation")).length, Object.keys(cells("item")).length]).toEqual([144, 7, 5, 0]);
    const p = planOrder(c, { head: { ...cells("voucher"), ...cells("ledger") }, item: cells("allocation") });
    expect(messages(p)).toBe("");
    const d = doc(p);
    expect(d.details!.custom).toEqual(expected("voucher"));
    expect(d.details!.ledgers[0]!.custom).toEqual(expected("ledger"));
    expect(d.lines[0]!.allocations![0]!.custom).toEqual(expected("allocation"));
    expect([d.totalPaise, d.lines[0]!.amountPaise]).toEqual([100000, 100000]);
    // The order page names every one of them.
    const { container, unmount } = render(<SalesOrderDetailsView details={d.details!} lines={d.lines} catalogue={c} />);
    const page = container.textContent ?? "";
    for (const f of able) expect(page.includes(f.tallyName), `${f.tallyName} on the order page`).toBe(true);
    unmount();
    // The entry form has an input for every one of them (its label carries the field's Tally name).
    const form = render(<SalesOrderEntryForm options={{ customers: [], products: [], ledgers: [] }} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={c} />);
    for (let round = 0; round < 5; round++) for (const b of [...form.container.querySelectorAll('button[aria-expanded="false"]')]) fireEvent.click(b);
    const labelled = new Set([...form.container.querySelectorAll("[title]")].map((e) => e.getAttribute("title")));
    expect(able.filter((f) => !labelled.has(f.tallyName)).map((f) => f.tallyName)).toEqual([]);
    // And none of the 82 that weren't enabled here is anywhere: not a column, not on the form.
    const off = SO_PROVISIONS.filter((f) => !able.includes(f));
    expect(off).toHaveLength(82);
    expect(off.filter((f) => labelled.has(f.tallyName) || templateHeadings(c).includes(f.tallyName))).toEqual([]);
  });

  it("taken off the form or the import by its setting, it stays off there", () => {
    const c = buildCatalogue([on("motorVehicleNo", { inForm: false }), on("portCode", { inImport: false })]);
    expect(formFields(c, "voucher").map((f) => f.key)).not.toContain("motorVehicleNo");
    expect(templateHeadings(c)).toContain("Motor Vehicle No.");
    expect(formFields(c, "voucher").map((f) => f.key)).toContain("portCode");
    expect(templateHeadings(c)).not.toContain("Port Code");
  });
});

describe("sections", () => {
  it("all 38 are there by default, enabled, in the worksheet's order; four hold fields every order needs and are always on", () => {
    const list = BASE_CATALOGUE.sectionList;
    expect(list).toHaveLength(38);
    expect(list.every((s) => s.enabled && !s.isCustom && s.label === s.name && s.setting === null)).toBe(true);
    expect(list.map((s) => s.displayOrder)).toEqual(SO_SECTIONS.map((_, i) => (i + 1) * 10));
    expect(list.filter((s) => s.fixedReason).map((s) => s.name)).toEqual(["General Details", "Ledger Details", "Item Details", "Item Allocations Details"]);
    expect(BASE_CATALOGUE.sectionByName.get("General Details")!.fixedReason).toMatch(/Voucher Type Name, Voucher Date, Voucher Number/);
    // Every locked field sits in one of them.
    for (const k of LOCKED_FIELD_KEYS) expect(BASE_CATALOGUE.sectionByName.get(BASE_CATALOGUE.byKey.get(k)!.section)!.fixedReason, k).toBeTruthy();
  });

  it("a section's label and order are settings: the screens use the label, and its fields follow its place", () => {
    const c = buildCatalogue([sectionRow("Order Details", { label: "Customer's order", displayOrder: 5 }), sectionRow("Voucher Status", { displayOrder: 15 })]);
    expect(c.sections.slice(0, 4)).toEqual(["Order Details", "General Details", "Voucher Status", "Ledger Details"]);
    expect(sectionLabel(c, "Order Details")).toBe("Customer's order");
    expect(sectionLabel(c, "General Details")).toBe("General Details");
    expect(c.sectionByName.get("Order Details")).toMatchObject({ name: "Order Details", label: "Customer's order", displayOrder: 5, isCustom: false, enabled: true });
    // Fields keep naming their section by its own name; the template puts the section's columns first now.
    expect(c.byKey.get("referenceNo")!.section).toBe("Order Details");
    expect(c.fields[0]!.key).toBe("referenceNo");
    expect(templateHeadings(c).slice(0, 5)).toEqual(["Order No(s)", "Order - Date", "Mode/Terms of Payment", "Other References", "Terms of Delivery"]);
    expect(salesOrderTemplateSheets(c)[2]!.rows.find((r) => r[0] === "Order No(s)")![1]).toBe("Customer's order");
    expect(validateSection(sectionInput({ name: "Order Details", label: "Customer's order", displayOrder: 5 }), BASE_CATALOGUE)).toEqual([]);
    expect(validateSection(sectionInput({ name: "Order Details", label: "Ledger Details" }), BASE_CATALOGUE).join(" ")).toMatch(/already the name of another section/);
    expect(validateSection(sectionInput({ name: "Order Details", displayOrder: 1.5 }), BASE_CATALOGUE).join(" ")).toMatch(/whole number/);
    expect(validateSection(sectionInput({ name: "No such section" }), BASE_CATALOGUE)).toEqual(["That section doesn't exist."]);
  });

  it("disabling a section switches its fields off everywhere and touches nothing stored; enabling it brings each back as it was", () => {
    const rows = [setting({ fieldKey: "destination", scope: "voucher", status: "retired" }), setting({ fieldKey: "carrier", scope: "voucher", label: "Transporter" })];
    const off = buildCatalogue([...rows, sectionRow("Dispatch/Receipt/Party's Document Details", { status: "retired" })]);
    const dispatch = off.fields.filter((f) => f.section === "Dispatch/Receipt/Party's Document Details");
    expect(dispatch).toHaveLength(9);
    expect(dispatch.every((f) => f.status === "retired" && f.sectionOff)).toBe(true);
    expect(off.byKey.get("carrier")).toMatchObject({ ownStatus: "active", status: "retired", label: "Transporter" });
    expect(off.sectionByName.get("Dispatch/Receipt/Party's Document Details")!.enabled).toBe(false);
    expect(templateHeadings(off)).not.toContain("Carrier Name/Agent");
    expect(formFields(off, "voucher").some((f) => f.section === "Dispatch/Receipt/Party's Document Details")).toBe(false);
    // An order no longer needs the section's mandatory fields; a file that still carries them is told why they are ignored.
    expect(messages(planOrder(off))).toBe("");
    expect(ignoredHeading(off, "Carrier Name/Agent")).toMatch(/its section, Dispatch\/Receipt\/Party's Document Details, is disabled/);
    // What an order already holds is still shown, marked retired.
    const stored = doc(planOrder(BASE_CATALOGUE));
    render(<SalesOrderDetailsView details={stored.details!} lines={stored.lines} catalogue={off} />);
    expect(screen.getByText("Transporter (retired)").nextSibling!.textContent).toBe("Test Transport");
    // Enabled again: every field as its own switch has it.
    const back = buildCatalogue([...rows, sectionRow("Dispatch/Receipt/Party's Document Details", { status: "active" })]);
    expect(back.byKey.get("carrier")).toMatchObject({ status: "active", sectionOff: false });
    expect(back.byKey.get("destination")).toMatchObject({ status: "retired", ownStatus: "retired", sectionOff: false });
    expect(messages(planOrder(back, { head: { carrier: "" } }))).toMatch(/“Carrier Name\/Agent”/);
  });

  it("a section that holds locked or pre-close fields can't be disabled, nor one another field's condition depends on", () => {
    for (const name of ["General Details", "Ledger Details", "Item Details", "Item Allocations Details"]) {
      expect(validateSection(sectionInput({ name, status: "retired" }), BASE_CATALOGUE).join(" "), name).toMatch(/can't be disabled\. It holds/);
      // Whatever a stored row says, it stays on.
      expect(buildCatalogue([sectionRow(name, { status: "retired" })]).sectionByName.get(name)!.enabled, name).toBe(true);
    }
    expect(validateSection(sectionInput({ name: "Order Details", status: "retired" }), BASE_CATALOGUE)).toEqual([]);
    const c = buildCatalogue([setting({ fieldKey: "carrier", scope: "voucher", requirement: "conditional", condition: { op: "in", field: "isOptional", values: ["No"] } })]);
    expect(validateSection(sectionInput({ name: "Voucher Status", status: "retired" }), c).join(" ")).toMatch(/Voucher Status can't be disabled: Carrier Name\/Agent depends on a field in it/);
  });

  it("a custom section is added on its own, holds custom fields and fields moved into it, and is managed like any other", () => {
    expect(validateSection(sectionInput({ name: "Logistics", isNew: true }), BASE_CATALOGUE)).toEqual([]);
    expect(validateSection(sectionInput({ name: "  ", isNew: true }), BASE_CATALOGUE)).toEqual(["Name the section."]);
    expect(validateSection(sectionInput({ name: "order details", isNew: true }), BASE_CATALOGUE).join(" ")).toMatch(/already the name of another section/);
    expect(validateSection(sectionInput({ name: "Item Details", isNew: true }), BASE_CATALOGUE).join(" ")).toMatch(/already a section called/);
    const empty = buildCatalogue([sectionRow("Logistics")]);
    expect(empty.sectionList).toHaveLength(39);
    expect(empty.sectionList.at(-1)).toMatchObject({ name: "Logistics", isCustom: true, enabled: true, key: "section_logistics", displayOrder: 1000 });
    const c = buildCatalogue([
      sectionRow("Logistics", { label: "Logistics & transport" }),
      setting({ fieldKey: "custom_route", isCustom: true, scope: "voucher", label: "Route", section: "Logistics", fieldType: "text", requirement: "optional" }),
      on("motorVehicleNo", { section: "Logistics" }),
      setting({ fieldKey: "carrier", scope: "voucher", section: "Logistics" }),
    ]);
    expect(c.fields.filter((f) => String(f.section) === "Logistics").map((f) => f.key).sort()).toEqual(["carrier", "custom_route", "motorVehicleNo"]);
    expect(validateSetting(input({ fieldKey: "carrier", scope: "voucher", section: "Logistics" }), empty)).toEqual([]);
    expect(validateSetting(input({ fieldKey: "documentNo", scope: "voucher", section: "Logistics" }), empty).join(" ")).toMatch(/locked: only its label/);
    // A moved field is imported and stored exactly as before; only its place on the screens changes.
    expect(messages(planOrder(c, { head: { motorVehicleNo: "MH12AB1234", custom_route: "NH48" } }))).toBe("");
    expect(salesOrderMappingFields(c).filter((f) => f.section === "Logistics").map((f) => f.key).sort()).toEqual(["carrier", "custom_route", "motorVehicleNo"]);
    render(<SalesOrderEntryForm options={{ customers: [], products: [], ledgers: [] }} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={c} />);
    expect(screen.getByRole("button", { name: /^Logistics & transport — Motor Vehicle No\./ })).toBeTruthy();
    // Disabling the custom section switches all three off, the matrix's mandatory Carrier among them.
    const off = buildCatalogue([sectionRow("Logistics", { status: "retired" }), setting({ fieldKey: "carrier", scope: "voucher", section: "Logistics" })]);
    expect(off.byKey.get("carrier")).toMatchObject({ status: "retired", sectionOff: true });
    // A section named only on a custom field (as before section settings existed) is a section too.
    const implicit = buildCatalogue([setting({ fieldKey: "custom_x", isCustom: true, scope: "item", label: "X", section: "Extra", fieldType: "text" })]);
    expect(implicit.sectionByName.get("Extra")).toMatchObject({ isCustom: true, enabled: true, setting: null, key: "section_extra" });
  });
});

describe("help text", () => {
  it("is a setting of a field or a section, shown with the field on the form; without one the field's own rule stands", () => {
    const c = buildCatalogue([setting({ fieldKey: "carrier", scope: "voucher", helpText: "  The transporter's registered name.  " }), sectionRow("Order Details", { helpText: "From the customer's purchase order." })]);
    expect(c.byKey.get("carrier")!.helpText).toBe("The transporter's registered name.");
    expect(c.byKey.get("destination")!.helpText).toBeNull();
    expect(c.sectionByName.get("Order Details")!.helpText).toBe("From the customer's purchase order.");
    expect(validateSetting(input({ fieldKey: "carrier", scope: "voucher", helpText: "x".repeat(500) }), BASE_CATALOGUE)).toEqual([]);
    expect(validateSetting(input({ fieldKey: "carrier", scope: "voucher", helpText: "x".repeat(501) }), BASE_CATALOGUE).join(" ")).toMatch(/longer than 500 characters/);
    expect(validateSection(sectionInput({ name: "Order Details", helpText: "x".repeat(501) }), BASE_CATALOGUE).join(" ")).toMatch(/longer than 500 characters/);
    render(<SalesOrderEntryForm options={{ customers: [], products: [], ledgers: [] }} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={c} />);
    expect(screen.getByText("The transporter's registered name.")).toBeTruthy();
  });
});

describe("Admin & Master Setup → Sales Order Fields over the whole catalogue", () => {
  const manager = (settings: FieldSetting[] = [], over: Partial<React.ComponentProps<typeof SalesOrderFieldsManager>> = {}) => render(<SalesOrderFieldsManager settings={settings} version={3} ready canManage history={[]} {...over} />);
  const pill = (group: string, name: RegExp) => within(screen.getByRole("group", { name: group })).getByRole("button", { name });

  it("shows every section and counts every field; a section with nothing enabled is folded until it is opened", () => {
    manager();
    expect(screen.getByText("353 fields")).toBeTruthy();
    expect(pill("Filter by scope", /All fields · 353/)).toBeTruthy();
    for (const [m, n] of [["Y", 65], ["\\?", 18], ["Provision", 8], ["x", 259], ["Update", 3], ["Custom", 0]] as const) expect(pill("Filter by original marking", new RegExp(`^${m} · ${n}$`)), m).toBeTruthy();
    // All 38 sections have a card.
    for (const s of SO_SECTIONS) expect(screen.getByRole("region", { name: s }), s).toBeTruthy();
    const eway = screen.getByRole("region", { name: "e-Way Bill Details" });
    expect(within(eway).getByText(/0 of 47 enabled/)).toBeTruthy();
    expect(within(eway).queryByRole("table")).toBeNull(); // folded
    fireEvent.click(within(eway).getByRole("button", { name: "Show e-Way Bill Details" }));
    expect(within(eway).getAllByRole("row")).toHaveLength(48); // the heading row and its 47 fields
    const row = within(eway).getByRole("button", { name: "Edit e-Way Bill No." }).closest("tr")!;
    for (const text of ["x in the matrix", "Record only", "Disabled", "Order"]) expect(within(row).getByText(text)).toBeTruthy();
    // General Details is open: its one provision is listed with the fields that are on.
    const general = screen.getByRole("region", { name: "General Details" });
    expect(within(general).getByText(/13 of 14 enabled/)).toBeTruthy();
    expect(within(within(general).getByRole("button", { name: "Edit Name on Receipt" }).closest("tr")!).getByText("Disabled")).toBeTruthy();
    expect(within(general).getByText("Always on")).toBeTruthy();
  });

  it("finds fields by name and narrows them by section, marking, scope, status and support level", () => {
    manager([on("motorVehicleNo")]);
    const matching = () => screen.getByRole("status").textContent;
    fireEvent.change(screen.getByLabelText("Find a field"), { target: { value: "vehicle" } });
    expect(matching()).toBe("5 of 353 fields match."); // Motor Vehicle No. and the e-Way Bill's four vehicle fields
    expect(screen.getByRole("button", { name: "Edit Motor Vehicle No." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit e-Way Bill Transport Details - Vehicle Number" })).toBeTruthy(); // its folded section opened for the match
    expect(screen.queryByRole("region", { name: "Order Details" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "enabled" } });
    expect(matching()).toBe("1 of 353 fields match.");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(pill("Filter by original marking", /^x · 259$/));
    expect(matching()).toBe("259 of 353 fields match.");
    fireEvent.change(screen.getByLabelText("Filter by support"), { target: { value: "needsWork" } });
    expect(matching()).toBe("0 of 353 fields match."); // nothing is blocked any more
    fireEvent.change(screen.getByLabelText("Filter by support"), { target: { value: "recordOnly" } });
    fireEvent.change(screen.getByLabelText("Filter by section"), { target: { value: "Bill Allocations" } });
    expect(matching()).toBe("14 of 353 fields match.");
    const bill = within(screen.getByRole("region", { name: "Bill Allocations" })).getByRole("button", { name: "Edit Bill Name" }).closest("tr")!;
    expect(within(bill).getByText("Repeating rows")).toBeTruthy();
    expect(within(bill).getByRole("button", { name: "Enable Bill Name" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    fireEvent.click(pill("Filter by original marking", /^Update · 3$/));
    expect(matching()).toBe("3 of 353 fields match.");
    fireEvent.click(pill("Filter by original marking", /^Y · 65$/));
    fireEvent.click(pill("Filter by scope", /^Ledger entry · /));
    expect(matching()).toBe("5 of 353 fields match.");
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "disabled" } });
    expect(screen.getByText("No field matches these filters.")).toBeTruthy();
  });

  it("enables a provision with one click, sending a complete setting; a disabled field can be enabled again", async () => {
    a.save.mockResolvedValue({ ok: true, fieldKey: "motorVehicleNo", version: 4 });
    manager([setting({ fieldKey: "priceLevel", scope: "voucher", status: "retired", rowVersion: 2 })]);
    fireEvent.click(screen.getByRole("button", { name: "Enable Motor Vehicle No." }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect(a.save.mock.calls[0]![0]).toEqual({ fieldKey: "motorVehicleNo", isCustom: false, scope: "voucher", label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", expectedRowVersion: 0 });
    await waitFor(() => expect(a.refresh).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Enable Price Level" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(2));
    expect(a.save.mock.calls[1]![0]).toMatchObject({ fieldKey: "priceLevel", status: "active", expectedRowVersion: 2 });
  });

  it("a field's dialog shows its marking, type and dependency, and saves its requirement, visibility and section", async () => {
    a.save.mockResolvedValue({ ok: true, fieldKey: "ewayBillNo", version: 5 });
    manager();
    fireEvent.click(within(screen.getByRole("region", { name: "e-Way Bill Details" })).getByRole("button", { name: "Show e-Way Bill Details" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit e-Way Bill No." }));
    const about = screen.getByLabelText("About this field");
    expect(about.textContent).toMatch(/x in the Read Me worksheet, row 133/);
    expect(about.textContent).toMatch(/Text · Text box \(set by Tally\)/);
    expect(about.textContent).toMatch(/Record only: the WMS stores, imports and shows the value as given\. No e-Way Bill is generated/);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "active" } });
    fireEvent.change(screen.getByLabelText("Requirement"), { target: { value: "mandatory" } });
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "Dispatch/Receipt/Party's Document Details" } });
    fireEvent.click(screen.getByLabelText("The order page"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect(a.save.mock.calls[0]![0]).toMatchObject({ fieldKey: "ewayBillNo", status: "active", requirement: "mandatory", section: "Dispatch/Receipt/Party's Document Details", onOrderPage: false, inForm: true, inImport: true, expectedRowVersion: 0 });
    // A repeating group's field: it says it is a column of rows, it can be enabled, and its section is fixed.
    fireEvent.change(screen.getByLabelText("Filter by section"), { target: { value: "Bill Allocations" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bill Name" }));
    expect(screen.getByLabelText("About this field").textContent).toMatch(/A column of the Bill Allocations rows: each ledger entry can carry any number of bill allocations/);
    expect((screen.getByLabelText("Status") as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByLabelText("Section") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "active" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Bill reference" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(2));
    expect(a.save.mock.calls[1]![0]).toMatchObject({ fieldKey: "billName", label: "Bill reference", status: "active", scope: "ledger" });
  });

  it("disables, relabels and reorders a section, and adds a custom one; an always-on section offers no switch", async () => {
    a.saveSection.mockResolvedValue({ ok: true, fieldKey: "section_order_details", version: 6 });
    manager([sectionRow("Voucher Status", { label: "Voucher flags", rowVersion: 4 })]);
    const order = screen.getByRole("region", { name: "Order Details" });
    fireEvent.click(within(order).getByRole("button", { name: "Disable section Order Details" }));
    await waitFor(() => expect(a.saveSection).toHaveBeenCalledTimes(1));
    expect(a.saveSection.mock.calls[0]![0]).toEqual({ name: "Order Details", isNew: false, label: null, displayOrder: null, status: "retired", expectedRowVersion: 0 });
    expect(within(screen.getByRole("region", { name: "General Details" })).queryByRole("button", { name: /Disable section/ })).toBeNull();

    // The renamed section is shown by its label, with its Tally name beside it; editing it names the version it read.
    const flags = screen.getByRole("region", { name: "Voucher flags" });
    expect(within(flags).getByText("Tally: Voucher Status")).toBeTruthy();
    fireEvent.click(within(flags).getByRole("button", { name: "Edit section Voucher flags" }));
    fireEvent.change(screen.getByLabelText("Section label"), { target: { value: "Voucher states" } });
    fireEvent.change(screen.getByLabelText("Section display order"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(a.saveSection).toHaveBeenCalledTimes(2));
    expect(a.saveSection.mock.calls[1]![0]).toEqual({ name: "Voucher Status", isNew: false, label: "Voucher states", displayOrder: 15, status: "active", expectedRowVersion: 4 });

    fireEvent.click(screen.getByRole("button", { name: /Add section/ }));
    expect((screen.getByRole("button", { name: "Save section" }) as HTMLButtonElement).disabled).toBe(true); // no name yet
    fireEvent.change(screen.getByLabelText("Section name"), { target: { value: "Order Details" } });
    expect(screen.getByRole("alert").textContent).toMatch(/already a section called/);
    fireEvent.change(screen.getByLabelText("Section name"), { target: { value: "Logistics" } });
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(a.saveSection).toHaveBeenCalledTimes(3));
    expect(a.saveSection.mock.calls[2]![0]).toEqual({ name: "Logistics", isNew: true, label: null, displayOrder: null, status: "active", expectedRowVersion: 0 });
  });

  it("a disabled section and a custom section are shown as such; a custom field is added straight into a section", async () => {
    a.save.mockResolvedValue({ ok: true, fieldKey: "custom_route", version: 7 });
    manager([sectionRow("Order Details", { status: "retired" }), sectionRow("Logistics")]);
    const order = screen.getByRole("region", { name: "Order Details" });
    expect(within(order).getByText("Section disabled")).toBeTruthy();
    expect(within(order).getByText(/0 of 5 enabled/)).toBeTruthy();
    expect(within(order).getByRole("button", { name: "Enable section Order Details" })).toBeTruthy();
    fireEvent.click(within(order).getByRole("button", { name: "Show Order Details" }));
    expect(within(within(order).getByRole("button", { name: "Edit Order No(s)" }).closest("tr")!).getByText("Off: section disabled")).toBeTruthy();
    const logistics = screen.getByRole("region", { name: "Logistics" });
    expect(within(logistics).getByText("Custom section")).toBeTruthy();
    fireEvent.click(within(logistics).getByRole("button", { name: "New field in Logistics" }));
    expect((screen.getByLabelText("Section") as HTMLInputElement).value).toBe("Logistics");
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Route" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect(a.save.mock.calls[0]![0]).toMatchObject({ fieldKey: null, isCustom: true, label: "Route", section: "Logistics", scope: "voucher", fieldType: "text" });
  });

  it("help text is edited once database update 0130 is there; before it, the box is off and nothing about it is sent", async () => {
    a.save.mockResolvedValue({ ok: true, fieldKey: "carrier", version: 8 });
    const { unmount } = manager();
    fireEvent.click(screen.getByRole("button", { name: "Edit Carrier Name/Agent" }));
    expect((screen.getByLabelText("Help text") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText(/Help text needs database update 0130/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    expect("helpText" in a.save.mock.calls[0]![0]).toBe(false);
    unmount();

    manager([setting({ fieldKey: "carrier", scope: "voucher", helpText: "Old text", rowVersion: 2 })], { helpTextReady: true });
    fireEvent.click(screen.getByRole("button", { name: "Edit Carrier Name/Agent" }));
    const box = screen.getByLabelText("Help text") as HTMLTextAreaElement;
    expect([box.disabled, box.value]).toEqual([false, "Old text"]);
    fireEvent.change(box, { target: { value: "The transporter's registered name." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(2));
    expect(a.save.mock.calls[1]![0]).toMatchObject({ fieldKey: "carrier", helpText: "The transporter's registered name.", expectedRowVersion: 2 });
  });

  it("the change history names sections as sections and says enabled / disabled", () => {
    manager([sectionRow("Order Details", { label: "Customer's order" }), on("motorVehicleNo")], {
      history: [
        { version: 3, fieldKey: "section_order_details", action: "retire", changedBy: "root", changedAt: "2026-11-16T10:00:00.000Z" },
        { version: 2, fieldKey: "motorVehicleNo", action: "create", changedBy: "root", changedAt: "2026-11-16T09:00:00.000Z" },
      ],
    });
    const history = screen.getByRole("region", { name: "Change history" });
    expect(within(history).getByText("Section: Customer's order")).toBeTruthy();
    expect(history.textContent).toMatch(/v3 · Section: Customer's order · disabled · root/);
    expect(history.textContent).toMatch(/v2 · Motor Vehicle No\. · create · root/);
  });
});
