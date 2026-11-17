// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 60_000 });

// The 82 fields that used to be "needs technical work": Tally's six REPEATING GROUPS (Bill, Bank, Tax Type, TDS Bill and
// TCS Bill Allocations under a ledger entry; Advance Payment details under the order) and the CASH/TRADE DISCOUNT.
// Each is enabled through the configuration and then used for real: template and mapping, import with validation and
// configured rules, storage, preview, duplicate comparison, order page and the manual form. All data is invented.
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

import { SalesOrderEntryForm } from "@/components/forms/tally/sales-order-entry-form";
import { SalesOrderDetailsView } from "@/components/forms/tally/sales-order-details";
import { planRows, type DocumentRecord, type RawRow } from "@/lib/tally/plan";
import { SO_FIELDS, SO_GROUPS, SO_PROVISIONS, type SoField, type SoGroupKey } from "@/lib/tally/sales-order-catalogue";
import { orderDifferences } from "@/lib/tally/sales-order-compare";
import { BASE_CATALOGUE, buildCatalogue, groupFields, ignoredHeading, importFields, scopeOfLevel, supportOf, validateSetting, type FieldSetting, type SettingInput, type SoCatalogue } from "@/lib/tally/sales-order-config";
import { itemAmountPaise, salesOrderFormRows, type SoFormOrder } from "@/lib/tally/sales-order-form";
import { salesOrderViews } from "@/lib/tally/sales-orders";
import { salesOrderTemplateSheets, templateHeadings, templateRow } from "@/lib/tally/sales-order-template";
import { soEntry, soLine, soVoucher, type SoCells } from "../fixtures/sales-order-rows";

const today = "2026-10-31";
const setting = (over: Partial<FieldSetting> & Pick<FieldSetting, "fieldKey" | "scope">): FieldSetting => ({
  isCustom: false, label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", rowVersion: 1, ...over,
});
const field = (key: string) => SO_FIELDS.find((f) => f.key === key)!;
const on = (key: string, over: Partial<FieldSetting> = {}) => setting({ fieldKey: key, scope: scopeOfLevel(field(key).level), ...over });
const input = (over: Partial<SettingInput> & Pick<SettingInput, "scope">): SettingInput => ({
  fieldKey: null, isCustom: false, label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null, inForm: true, inImport: true, onOrderPage: true, status: "active", ...over,
});
const fieldsOf = (g: SoGroupKey) => SO_FIELDS.filter((f) => f.group === g);
/** Every field of these groups switched on (plus any other settings). */
const enable = (groups: SoGroupKey[], more: FieldSetting[] = []) => buildCatalogue([...groups.flatMap((g) => fieldsOf(g).map((f) => on(f.key))), ...more]);
/** A valid value for a field, as typed and as stored. */
const sample = (f: SoField, n = 1): [typed: string, stored: string] =>
  f.type === "date" ? [`0${n}-04-2026`, `2026-04-0${n}`] : f.type === "amount" ? [`${n}2.5`, `${n}2.50`] : f.type === "number" ? [`${n}`, `${n}`] : f.type === "percent" ? [`${n}`, `${n}`] : f.type === "yesno" ? ["yes", "Yes"] : f.type === "choice" ? [f.options![0]!.toLowerCase(), f.options![0]!] : [`${f.key} ${n}`, `${f.key} ${n}`];
const typed = (g: SoGroupKey, n: number, over: SoCells = {}): SoCells => ({ ...Object.fromEntries(fieldsOf(g).map((f) => [f.key, sample(f, n)[0]])), ...over });
const stored = (g: SoGroupKey, n: number, over: Record<string, string> = {}) => ({ ...Object.fromEntries(fieldsOf(g).map((f) => [f.key, sample(f, n)[1]])), ...over });

/** An order in a configuration's own template layout, planned under it: the head row (the customer's ledger), the item row (the sales ledger) and any more rows. */
function run(c: SoCatalogue, over: { head?: SoCells; item?: SoCells; more?: SoCells[] } = {}) {
  const head = templateRow(c, { documentDate: "01-04-2026", documentNo: "SO/G/1", partyName: "Alpha Traders", amount: "1000", drCr: "Dr", ...soVoucher("Alpha Traders"), ...soEntry, orderDate: "01-04-2026", ...over.head });
  const item = templateRow(c, { partyName: "Sales", amount: "1000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: "1000", lineAmount: "1000", ...soLine("1000"), ...over.item });
  const rows: RawRow[] = [head, item, ...(over.more ?? []).map((cells) => templateRow(c, cells))].map((cells, i) => ({ rowNo: i + 2, cells }));
  const mapping = Object.fromEntries(importFields(c).map((f, i) => [f.key, i]));
  const plan = planRows("sales-orders", rows, mapping, { asOfDate: null, direction: null, today, soCatalogue: c });
  return { plan, rows, mapping, messages: plan.rows.flatMap((r) => r.messages).join(" | "), doc: plan.records[0] as DocumentRecord | undefined };
}

afterEach(() => cleanup());

describe("the 82 fields", () => {
  it("are six repeating groups (80 fields) and the cash/trade discount (2): none blocked, every one can be enabled", () => {
    const count = Object.fromEntries(SO_GROUPS.map((g) => [g.key, fieldsOf(g.key).length]));
    expect(count).toEqual({ billAllocations: 14, bankAllocations: 24, taxTypeAllocations: 8, tdsBillAllocations: 9, tcsBillAllocations: 9, advancePayments: 16 });
    const grouped = SO_FIELDS.filter((f) => f.group);
    expect(grouped).toHaveLength(80);
    for (const g of SO_GROUPS) expect(fieldsOf(g.key).every((f) => f.section === g.section && scopeOfLevel(f.level) === (g.parent === "ledger" ? "ledger" : "voucher")), g.key).toBe(true);
    const all82 = [...grouped, field("cashTradeDiscRate"), field("cashTradeDiscAmount")];
    expect(all82.every((f) => f.defaultOff && supportOf(f) !== "needsWork")).toBe(true);
    for (const f of all82) expect(validateSetting(input({ fieldKey: f.key, scope: scopeOfLevel(f.level), status: "active" }), BASE_CATALOGUE), f.tallyName).toEqual([]);
    expect(SO_PROVISIONS.filter((f) => supportOf(f) === "needsWork")).toEqual([]);
    // Off until enabled: today's 112-column template is unchanged.
    expect(templateHeadings(BASE_CATALOGUE)).toHaveLength(112);
    expect(all82.some((f) => templateHeadings(BASE_CATALOGUE).includes(f.tallyName))).toBe(false);
  });
});

describe.each(SO_GROUPS.map((g) => [g.key, g] as const))("repeating group %s", (key, g) => {
  const c = enable([key]);
  const fields = fieldsOf(key);

  it("enabled, each field is a template column and every row of the group is imported, checked and stored with its parent", () => {
    expect(templateHeadings(c)).toEqual(expect.arrayContaining(fields.map((f) => f.tallyName)));
    expect(groupFields(c, key).map((f) => f.key)).toEqual(fields.map((f) => f.key));
    // The amounts of a group that adds up to its ledger entry are made to (1000 = 600 + 400), so nothing is flagged.
    const t = g.totalField;
    const r = run(c, {
      head: typed(key, 1, t ? { [t]: "1000" } : {}),
      item: typed(key, 2, t ? { [t]: "600" } : {}),
      more: [typed(key, 3, t ? { [t]: "400" } : {})],
    });
    expect(r.messages).toBe("");
    const d = r.doc!;
    const want = (n: number, amount?: string) => stored(key, n, t && amount ? { [t]: amount } : {});
    if (g.parent === "ledger") {
      // The head row's row belongs to the customer's entry; the item row's and the row below it to the sales ledger's.
      expect(d.details!.ledgers[0]!.groups![key]).toEqual([{ rowNo: 2, values: want(1, "1000.00") }]);
      expect(d.details!.ledgers[1]!.groups![key]).toEqual([{ rowNo: 3, values: want(2, "600.00") }, { rowNo: 4, values: want(3, "400.00") }]);
      expect(d.details!.groups).toBeUndefined();
      // Never mixed into the entry's single-value fields.
      expect(d.details!.ledgers[0]!.custom).toBeUndefined();
    } else {
      expect(d.details!.groups![key]).toEqual([{ rowNo: 2, values: want(1) }, { rowNo: 3, values: want(2) }, { rowNo: 4, values: want(3) }]);
      expect(d.details!.custom).toBeUndefined();
      expect(d.details!.ledgers.some((l) => l.groups)).toBe(false);
    }
    // Recorded rows never change the order's amounts.
    expect([d.totalPaise, d.lines[0]!.amountPaise]).toEqual([100000, 100000]);
  });

  it("a value that isn't valid for its field is refused on its row, by its Tally name", () => {
    const typedField = fields.find((f) => f.type !== "text")!;
    const bad = typedField.type === "date" ? "31-02-2026" : typedField.type === "yesno" ? "maybe" : typedField.type === "choice" ? "Not a value" : "abc";
    const r = run(c, { more: [{ [typedField.key]: bad }] });
    expect(r.plan.rows[2]!.state).toBe("invalid");
    expect(r.plan.rows[2]!.messages.join(" ")).toContain(`“${typedField.tallyName}”`);
    expect(r.doc).toBeUndefined();
  });

  it("a field made mandatory is required on EVERY row of the group, not on the order", () => {
    const first = fields[0]!;
    const c2 = enable([key], [on(first.key, { requirement: "mandatory" })]);
    expect(run(c2).messages).toBe(""); // no rows: nothing is asked for
    const other = fields[1]!;
    const r = run(c2, { more: [{ [other.key]: sample(other)[0] }] });
    expect(r.messages).toMatch(new RegExp(`Required field is blank on this ${g.rowLabel}: “${first.tallyName.replace(/[()/.]/g, "\\$&")}”`));
    expect(run(c2, { more: [{ [first.key]: sample(first)[0], [other.key]: sample(other)[0] }] }).messages).not.toMatch(/Required|isn't/);
  });

  it("disabled, or left out of imports, a field isn't read; its column is reported as ignored", () => {
    const f = fields[0]!;
    const off = enable([key], [on(f.key, { status: "retired" })]);
    expect(templateHeadings(off)).not.toContain(f.tallyName);
    // A provision switched off again reads as one nobody enabled: how to switch it on.
    expect(ignoredHeading(off, f.tallyName)).toMatch(/An administrator can enable it/);
    expect(importFields(off).some((x) => x.key === f.key)).toBe(false);
    const noImport = enable([key], [on(f.key, { requirement: "optional", inImport: false })]);
    expect(ignoredHeading(noImport, f.tallyName)).toMatch(/left out of imports/);
    expect(ignoredHeading(BASE_CATALOGUE, f.tallyName)).toMatch(/An administrator can enable it/);
  });

  it("is in the preview, the duplicate comparison and the order page", () => {
    const head = typed(key, 1);
    const r = run(c, { head, more: [typed(key, 2)] });
    expect(r.messages.replace(/ \| /g, "")).not.toMatch(/Required|isn't/);
    const d = r.doc!;
    // Preview: the order says how many rows of the group it carries.
    const view = salesOrderViews(r.plan.rows, r.rows, r.mapping, c)[0]!;
    expect(view.facts).toContainEqual({ label: g.section, value: `2 ${g.rowLabel}s` });
    // Comparison: the same rows in another order of the file are the same order; a changed value is named.
    const again = run(c, { more: [typed(key, 2)], head });
    expect(orderDifferences(d, again.doc!)).toEqual([]);
    const f = fields.find((x) => x.type === "text")!;
    const changed = run(c, { head, more: [typed(key, 2, { [f.key]: "changed" })] });
    const diffs = orderDifferences(d, changed.doc!);
    expect(diffs).toHaveLength(1);
    // The row below the item row is the sales ledger's.
    expect(diffs[0]!.label).toBe(g.parent === "ledger" ? `Ledger "Sales" · ${g.section}` : `Order · ${g.section}`);
    // Order page: a table of the rows, headed by the fields' names.
    render(<SalesOrderDetailsView details={d.details!} lines={d.lines} catalogue={c} />);
    const table = screen.getByRole("table", { name: `${g.section} — ${g.parent === "ledger" ? 'ledger "Alpha Traders"' : "the order"}` });
    // The customer's table: its one row (the other row is the sales ledger's); the order's: both rows.
    expect(within(table).getAllByRole("row")).toHaveLength(g.parent === "ledger" ? 2 : 3);
    for (const x of fields) expect(within(table).getByRole("columnheader", { name: x.tallyName })).toBeTruthy();
  });
});

describe("the configuration drives the groups", () => {
  it("labels, display order, allowed values and the order-page switch are honoured", () => {
    const c = enable(["billAllocations"], [
      on("billName", { label: "Invoice ref", displayOrder: 1 }),
      on("billTypeOfRef", { options: ["New Ref", "Agst Ref"] }),
      on("billInterestLimit", { onOrderPage: false }),
    ]);
    expect(groupFields(c, "billAllocations")[0]!.key).toBe("billName"); // first by its display order
    expect(run(c, { more: [{ billTypeOfRef: "On Account" }] }).messages).toMatch(/“Bill Type of Ref” "On Account" isn't one of: Agst Ref, New Ref|isn't one of: New Ref, Agst Ref/);
    const d = run(c, { head: { billName: "INV-1", billTypeOfRef: "new ref", billAmount: "1000", billInterestLimit: "9" } }).doc!;
    expect(d.details!.ledgers[0]!.groups!.billAllocations![0]!.values).toEqual({ billName: "INV-1", billTypeOfRef: "New Ref", billAmount: "1000.00", billInterestLimit: "9" });
    render(<SalesOrderDetailsView details={d.details!} lines={d.lines} catalogue={c} />);
    const table = screen.getByRole("table", { name: 'Bill Allocations — ledger "Alpha Traders"' });
    expect(within(table).getByRole("columnheader", { name: "Invoice ref" })).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "Interest - Limit" })).toBeNull();
  });

  it("a condition within a row: Bill Amount - Dr/Cr required when the row has a Bill Amount", () => {
    const rule = { requirement: "conditional" as const, condition: { op: "given" as const, field: "billAmount" } };
    // Its condition must be on a field that is on: Bill Amount is off until the group is enabled.
    expect(validateSetting(input({ fieldKey: "billAmountDrCr", scope: "ledger", ...rule }), BASE_CATALOGUE).join(" ")).toMatch(/depends on Bill Amount, which is retired/);
    expect(validateSetting(input({ fieldKey: "billAmountDrCr", scope: "ledger", ...rule }), enable(["billAllocations"]))).toEqual([]);
    const c = enable(["billAllocations"], [on("billAmountDrCr", rule)]);
    expect(run(c, { more: [{ billName: "INV-1" }] }).messages).toBe("");
    expect(run(c, { more: [{ billName: "INV-1", billAmount: "1000" }] }).messages).toMatch(/Required field is blank on this bill allocation: “Bill Amount - Dr\/Cr”/);
    expect(run(c, { more: [{ billName: "INV-1", billAmount: "1000", billAmountDrCr: "Dr" }] }).messages).toBe("");
  });

  it("a condition can read a row's ledger entry and the order, and \"the customer's entry only\"", () => {
    const c = enable(["tdsBillAllocations"], [on("tdsBillName", { requirement: "conditional", condition: { op: "ledgerKind", values: ["other"] } })]);
    expect(run(c, { head: { tdsBillPartyLedger: "x" } }).messages).toBe(""); // the customer's entry: not required
    expect(run(c, { item: { tdsBillPartyLedger: "x" } }).messages).toMatch(/“TDS Bill Allocations - Name”/); // the sales ledger's
    const byOrder = enable(["advancePayments"], [on("advAmount", { requirement: "conditional", condition: { op: "in", field: "isPostDated", values: ["No"] } })]);
    expect(run(byOrder, { more: [{ advLedgerName: "Advance" }] }).messages).toMatch(/Required field is blank on this advance line: “Advance Payment\/Receipt\/Refund Details - Advance Amount”/);
  });

  it("conditions can't cross groups: a group field reads its own row, a field outside the group none", () => {
    expect(validateSetting(input({ fieldKey: "billName", scope: "ledger", requirement: "conditional", condition: { op: "given", field: "bankAmount" } }), BASE_CATALOGUE).join(" ")).toMatch(/same bill allocation, of its ledger entry or of the order, not on Bank Allocations - Amount/);
    expect(validateSetting(input({ fieldKey: "ledgerNarration", scope: "ledger", requirement: "conditional", condition: { op: "given", field: "billName" } }), BASE_CATALOGUE).join(" ")).toMatch(/Bill Name is a column of the Bill Allocations rows: a field outside them can't depend on it/);
    expect(validateSetting(input({ fieldKey: "billName", scope: "ledger", requirement: "conditional", condition: { op: "given", field: "ledgerNarration" } }), BASE_CATALOGUE)).toEqual([]);
    expect(validateSetting(input({ fieldKey: "billName", scope: "ledger", section: "Order Details" }), BASE_CATALOGUE).join(" ")).toMatch(/stays in that section/);
  });

  it("Tally's totals: a group's amounts that don't add up to its ledger entry are flagged for review, not refused", () => {
    for (const [key, t] of [["billAllocations", "billAmount"], ["bankAllocations", "bankAmount"], ["taxTypeAllocations", "taxTypeAmount"]] as const) {
      const r = run(enable([key]), { item: { [t]: "600" }, more: [{ [t]: "300" }] });
      expect(r.plan.rows[1]!.state, key).toBe("attention");
      expect(r.messages, key).toMatch(new RegExp(`add up to ₹900\\.00, not its ₹1,000\\.00`));
      expect(r.doc, key).toBeTruthy();
    }
  });

  it("a whole group disabled with its section: nothing of it is read, and stored rows are still shown, marked retired", () => {
    const c = enable(["bankAllocations"]);
    const d = run(c, { head: { bankName: "State Bank", bankAmount: "1000" } }).doc!;
    const off = enable(["bankAllocations"], [setting({ fieldKey: "section_bank_allocations_details", scope: "voucher", section: "Bank Allocations Details", status: "retired" })]);
    expect(groupFields(off, "bankAllocations")).toEqual([]);
    expect(templateHeadings(off).some((h) => h.startsWith("Bank Allocations"))).toBe(false);
    render(<SalesOrderDetailsView details={d.details!} lines={d.lines} catalogue={off} />);
    const table = screen.getByRole("table", { name: 'Bank Allocations Details — ledger "Alpha Traders"' });
    expect(within(table).getByRole("columnheader", { name: "Bank Allocations - Bank Name (retired)" })).toBeTruthy();
    expect(within(table).getByText("State Bank")).toBeTruthy();
  });

  it("the template's Read Me explains the rows", () => {
    const readMe = salesOrderTemplateSheets(enable(["billAllocations"]))[2]!.rows;
    expect(readMe.some((r) => /Repeating groups .* one row per entry of the group/.test(r[0] ?? ""))).toBe(true);
    expect(readMe.find((r) => r[0] === "Bill Name")![3]).toMatch(/One value per row of the group\. .*one row per bill reference/);
  });
});

describe("the manual form: rows added and removed by hand become the same rows a file would hold", () => {
  const options = { customers: [], products: [], ledgers: [] };

  it("bill allocations under the customer's ledger and advance lines on the order", () => {
    const c = enable(["billAllocations", "advancePayments"], [on("billName", { requirement: "mandatory" })]);
    const onCheck = vi.fn();
    render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={onCheck} loadCustomer={async () => null} catalogue={c} />);
    fireEvent.click(screen.getByRole("button", { name: /^Bill Allocations of the customer ledger/ }));
    const add = () => fireEvent.click(screen.getByRole("button", { name: "Add bill allocation" }));
    add();
    add();
    add();
    expect(screen.getAllByRole("group", { name: /^Bill Allocations \d of the customer ledger$/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove bill allocation 2 of the customer ledger" }));
    expect(screen.getAllByRole("group", { name: /^Bill Allocations \d of the customer ledger$/ })).toHaveLength(2);
    // A mandatory column is starred on every row.
    expect(screen.getByLabelText("Bill Name of the customer ledger bill allocation 1").closest("label")!.textContent).toMatch(/Bill Name\*/);
    fireEvent.change(screen.getByLabelText("Bill Name of the customer ledger bill allocation 1"), { target: { value: "INV-1" } });
    fireEvent.change(screen.getByLabelText("Bill Amount of the customer ledger bill allocation 1"), { target: { value: "600" } });
    fireEvent.change(screen.getByLabelText("Bill Name of the customer ledger bill allocation 2"), { target: { value: "INV-2" } });
    fireEvent.change(screen.getByLabelText("Bill Type of Ref of the customer ledger bill allocation 2"), { target: { value: "New Ref" } });
    // The order's advance lines.
    for (let round = 0; round < 3; round++) for (const b of [...document.querySelectorAll('button[aria-expanded="false"]')]) if (/Other Tally sections|Advance Payment/.test(b.textContent ?? "")) fireEvent.click(b);
    fireEvent.click(screen.getByRole("button", { name: "Add advance line" }));
    fireEvent.change(screen.getByLabelText("Advance Payment/Receipt/Refund Details - Ledger Name of the order advance line 1"), { target: { value: "Advance from customer" } });
    fireEvent.click(screen.getByRole("button", { name: /Check order/ }));
    const order = onCheck.mock.calls[0]![0] as SoFormOrder;
    expect(order.party.groups!.billAllocations).toEqual([{ billName: "INV-1", billAmount: "600" }, { billName: "INV-2", billTypeOfRef: "New Ref" }]);
    expect(order.groups!.advancePayments).toEqual([{ advLedgerName: "Advance from customer" }]);
    // The rows the form makes: the customer's rows right under the customer's ledger row, the order's at the end.
    const built = salesOrderFormRows(order, c);
    expect(built.sources.map((s) => s.label)).toEqual(["Order and customer ledger", "Customer ledger · bill allocation 1", "Customer ledger · bill allocation 2", "Item 1", "Order · advance line 1"]);
    const col = (k: string) => built.headers.indexOf(field(k).tallyName);
    expect([built.rows[1]!.cells[col("billName")], built.rows[2]!.cells[col("billTypeOfRef")], built.rows[4]!.cells[col("advLedgerName")]]).toEqual(["INV-1", "New Ref", "Advance from customer"]);
  });

  it("an entered order goes through the import and stores the rows on the right ledger and the order", () => {
    const c = enable(["bankAllocations", "advancePayments"]);
    const o: SoFormOrder = {
      voucher: { ...soVoucher("Alpha Traders"), documentDate: "2026-04-01", documentNo: "SO/F/9", orderDate: "2026-04-01" },
      separateConsignee: false,
      customerId: "c1",
      customerName: "Alpha Traders",
      party: { rate: "0", narration: "N", description: "D", costCentres: [], groups: { bankAllocations: [{ bankName: "State Bank", bankAmount: "1000" }] } },
      sales: { name: "Sales", rate: "0", narration: "N", description: "D", costCentres: [], groups: { bankAllocations: [{ bankName: "HDFC", bankAmount: "1000" }] } },
      items: [{ productRef: "sku:s1", itemName: "Gear Motor", values: { itemDescription: "Motor", quantity: "1", rate: "1000", ratePer: "Nos", gstRateDetails: "As per Masters/Company", reverseCharge: "No", itcEligible: "No", taxableValue: "1000.00", hsnDetails: "As per Masters/Company" }, allocations: [{ dueDate: "2026-04-15" }] }],
      ledgers: [{ name: "Freight", amount: "0", drCr: "Cr", rate: "0", narration: "N", description: "D", costCentres: [], groups: { bankAllocations: [{ bankName: "Axis" }, { bankName: "ICICI" }] } }],
      additionalCosts: [],
      groups: { advancePayments: [{ advLedgerName: "Advance", advAmount: "250" }] },
    };
    const built = salesOrderFormRows(o, c);
    const mapping = Object.fromEntries(importFields(c).map((f, i) => [f.key, i]));
    const p = planRows("sales-orders", built.rows, mapping, { asOfDate: null, direction: null, today, soCatalogue: c });
    expect(p.rows.flatMap((r) => r.messages)).toEqual([]);
    const d = (p.records[0] as DocumentRecord).details!;
    const banks = (i: number) => d.ledgers[i]!.groups!.bankAllocations!.map((r) => r.values.bankName);
    expect([d.ledgers.map((l) => l.name), banks(0), banks(1), banks(2)]).toEqual([["Alpha Traders", "Sales", "Freight"], ["State Bank"], ["HDFC"], ["Axis", "ICICI"]]);
    expect(d.groups!.advancePayments!.map((r) => r.values)).toEqual([{ advLedgerName: "Advance", advAmount: "250.00" }]);
  });

  it("a column taken off the form isn't offered; the group isn't offered at all while none of its fields is on", () => {
    const c = enable(["taxTypeAllocations"], [on("taxTypeName", { inForm: false, requirement: "optional" })]);
    render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={c} />);
    fireEvent.click(screen.getByRole("button", { name: /^Tax Type Allocations of the customer ledger/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add tax type allocation" }));
    expect(screen.queryByLabelText("Tax Type Allocations - Tax Type of the customer ledger tax type allocation 1")).toBeNull();
    expect(screen.getByLabelText("Tax Type Allocations - Amount of the customer ledger tax type allocation 1")).toBeTruthy();
    cleanup();
    render(<SalesOrderEntryForm options={options} disabled={false} busy={false} problems={[]} onCheck={vi.fn()} loadCustomer={async () => null} catalogue={BASE_CATALOGUE} />);
    expect(screen.queryByRole("button", { name: /Allocations of the customer ledger/ })).toBeNull();
  });
});

describe("the cash/trade discount", () => {
  const c = buildCatalogue([on("cashTradeDiscRate"), on("cashTradeDiscAmount")]);
  // 2 × ₹1,000 less Disc% 10 = ₹1,800; less cash/trade 5% = ₹1,710; less ₹10 = ₹1,700.
  const line = (over: SoCells = {}) => ({ quantity: "2", rate: "1000", discPct: "10", cashTradeDiscRate: "5", cashTradeDiscAmount: "10", lineAmount: "1700", taxableValue: "1700", ...over });

  it("is taken off the line amount after its Disc% and Discount Amount: rate first, then amount", () => {
    const r = run(c, { head: { amount: "1700" }, item: { amount: "1700", ...line() } });
    expect(r.messages).toBe("");
    expect(r.doc!.lines[0]).toMatchObject({ amountPaise: 170000, custom: { cashTradeDiscRate: "5", cashTradeDiscAmount: "10.00" } });
    expect(run(c, { head: { amount: "1800" }, item: { amount: "1800", ...line({ lineAmount: "1800", taxableValue: "1800" }) } }).messages).toMatch(/Item amount ₹1,800\.00 doesn't equal quantity × rate less the discount and the cash\/trade discount \(₹1,700\.00\)/);
  });

  it("a single delivery carries the line's value before it; split deliveries add up to that value", () => {
    const single = run(c, { head: { amount: "1700" }, item: { amount: "1700", ...line() } }).doc!;
    expect(single.lines[0]!.allocations).toEqual([expect.objectContaining({ quantity: 2, amountPaise: 180000 })]);
    const split = run(c, {
      head: { amount: "1700" },
      item: { amount: "1700", ...line(), allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocDiscPct: "10", allocAmount: "900", dueDate: "15-04-2027" },
      more: [{ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocDiscPct: "10", allocAmount: "900", dueDate: "20-04-2027" }],
    });
    expect(split.messages).toBe("");
    const short = run(c, {
      head: { amount: "1700" },
      item: { amount: "1700", ...line(), allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocDiscPct: "10", allocAmount: "900", dueDate: "15-04-2027" },
      more: [{ allocQuantity: "1", allocRate: "1000", allocRatePer: "Nos", allocDiscPct: "15", allocAmount: "850", dueDate: "20-04-2027" }],
    });
    expect(short.messages).toMatch(/add up to ₹1,750\.00, not the line's value before its cash\/trade discount ₹1,800\.00/);
  });

  it("is checked as a percentage and an amount, compared, and shown; while off, it is never read", () => {
    expect(run(c, { item: { cashTradeDiscRate: "150" } }).messages).toMatch(/“Discount Rate \(Cash\/Trade\)” "150" isn't a percentage from 0 to 100/);
    // On a line whose amount relies on it, the unreadable value is what is reported — not a sum that doesn't add up.
    const unreadable = run(c, { head: { amount: "1700" }, item: { amount: "1700", ...line({ cashTradeDiscAmount: "ten" }) } }).messages;
    expect(unreadable).toMatch(/“Discount Amount \(Cash\/Trade\)” "ten" isn't a valid amount/);
    expect(unreadable).not.toMatch(/doesn't equal quantity × rate/);
    const a = run(c, { head: { amount: "1700" }, item: { amount: "1700", ...line() } }).doc!;
    const b = run(c, { head: { amount: "1700" }, item: { amount: "1700", ...line({ cashTradeDiscRate: "", cashTradeDiscAmount: "", discAmount: "100", discPct: "10" }) } });
    expect(orderDifferences(a, b.doc!).map((x) => x.label)).toEqual(expect.arrayContaining(['Item "Gear Motor" · Discount Rate (Cash/Trade)']));
    render(<SalesOrderDetailsView details={a.details!} lines={a.lines} catalogue={c} />);
    expect(within(screen.getByRole("table", { name: "Allocations, GST and HSN/SAC" })).getByText(/Discount Rate \(Cash\/Trade\): 5/)).toBeTruthy();
    // Under the matrix alone the columns aren't mapped, so a line that relied on them doesn't add up.
    expect(templateHeadings(BASE_CATALOGUE)).not.toContain("Discount Rate (Cash/Trade)");
  });

  it("the form works the line amount out the same way, and the form's input reaches the import", () => {
    expect(itemAmountPaise(line())).toBe(170000);
    expect(itemAmountPaise({ quantity: "2", rate: "1000" })).toBe(200000);
    const onCheck = vi.fn();
    render(<SalesOrderEntryForm options={{ customers: [], products: [], ledgers: [] }} disabled={false} busy={false} problems={[]} onCheck={onCheck} loadCustomer={async () => null} catalogue={c} />);
    fireEvent.click(screen.getByRole("button", { name: /^More item details — .*Discount Rate \(Cash\/Trade\), Discount Amount \(Cash\/Trade\)/ }));
    fireEvent.change(screen.getByLabelText("Discount Rate (Cash/Trade) of item 1"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Check order/ }));
    expect((onCheck.mock.calls[0]![0] as SoFormOrder).items[0]!.values.cashTradeDiscRate).toBe("5");
  });
});
