import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite, running the migrations' own SQL) for the complete Sales Order field catalogue
// in Admin & Master Setup → Sales Order Fields: section settings and provisions (the x fields off by default) on a
// database that has 0128 only — exactly what production has today — and then help text once 0130 is applied on top.
// Invented data only; only the session (and which addresses count as super-admins) is mocked. Nothing here reaches a
// real database.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean; departmentId: null } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ SUPER_ADMIN_EMAILS: ["root@example.test"], isSuperAdmin: (e: string | null | undefined) => (e ?? "").trim().toLowerCase() === "root@example.test" }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { chunkRows, planRows, type RawRow } from "@/lib/tally/plan";
import { SO_PROVISIONS } from "@/lib/tally/sales-order-catalogue";
import { importFields, scopeOfLevel, supportOf, type SoCatalogue } from "@/lib/tally/sales-order-config";
import { templateHeadings, templateRow } from "@/lib/tally/sales-order-template";
import { soEntry, soLine, soVoucher, type SoCells } from "../fixtures/sales-order-rows";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let fieldActions: typeof import("@/app/(masters)/master-setup/sales-order-fields/actions");
let importActions: typeof import("@/app/(forms-module)/forms/tally-import/actions");
let fieldsQ: typeof import("@/lib/queries/sales-order-fields");
const who: Record<"root" | "manager" | "admin", string> = { root: "", manager: "", admin: "" };
const TODAY = "2026-10-31";
const MIGRATION = (name: string) => readFileSync(resolve(__dirname, "../../db/migrations", name), "utf8");
let seq = 0;
const hash = () => String(++seq).padStart(64, "0");

const signIn = (k: keyof typeof who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: true, departmentId: null };
};
const fieldInput = (over: Record<string, unknown>) => ({
  fieldKey: null, isCustom: false, scope: "voucher", label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null,
  inForm: true, inImport: true, onOrderPage: true, status: "active", expectedRowVersion: 0, ...over,
});
const saveField = (over: Record<string, unknown>) => fieldActions.saveSalesOrderField(fieldInput(over));
const saveSection = (over: Record<string, unknown>) => fieldActions.saveSalesOrderSection({ isNew: false, label: null, displayOrder: null, status: "active", expectedRowVersion: 0, ...over });
const load = () => fieldsQ.loadSalesOrderCatalogue();
const current = async () => (await load()).catalogue;
const row = async (key: string) => (await pg.query<Record<string, unknown>>(`select * from sales_order_field_settings where field_key = $1`, [key])).rows[0];
const history = async (key: string) => (await pg.query<{ action: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>(`select action, before, after from sales_order_field_history where field_key = $1 order by version`, [key])).rows;
const counts = async () => (await pg.query<{ s: number; h: number }>(`select (select count(*)::int from sales_order_field_settings) s, (select count(*)::int from sales_order_field_history) h`)).rows[0]!;

function orderRows(c: SoCatalogue, no: string, over: { head?: SoCells; item?: SoCells } = {}): RawRow[] {
  const head = templateRow(c, { documentDate: "01-04-2026", documentNo: no, partyName: "Alpha Traders", amount: "1000", drCr: "Dr", ...soVoucher("Alpha Traders"), ...soEntry, orderDate: "01-04-2026", ...over.head });
  const item = templateRow(c, { partyName: "Sales", amount: "1000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: "1000", lineAmount: "1000", ...soLine("1000"), ...over.item });
  return [head, item].map((cells, i) => ({ rowNo: i + 2, cells }));
}
const mappingOf = (c: SoCatalogue) => Object.fromEntries(importFields(c).map((f, i) => [f.key, i]));
async function importOrder(c: SoCatalogue, data: RawRow[], version: number, between?: () => Promise<unknown>) {
  const mapping = mappingOf(c);
  const started = await importActions.startTallyImport({ fieldConfigVersion: version, category: "sales-orders", fileName: "orders.xlsx", fileHash: hash(), sheetName: "Accounting Voucher", headers: templateHeadings(c), sample: data, mapping, totalRows: data.length, asOfDate: null, direction: null, includeAttention: false, confirm: true });
  if (!started.ok) return { started, chunks: [] as unknown[], finished: null };
  await between?.();
  const plan = planRows("sales-orders", data, mapping, { asOfDate: null, direction: null, today: TODAY, soCatalogue: c });
  const chunks = [];
  for (const part of chunkRows(data, plan.rows)) chunks.push(await importActions.importTallyChunk({ fieldConfigVersion: version, batchId: started.batchId, rows: part }));
  const finished = await importActions.finishTallyImport(started.batchId);
  return { started, chunks, finished };
}
const stored = async (no: string) => (await pg.query<{ details: { custom?: Record<string, unknown>; ledgers: { custom?: Record<string, unknown> }[]; dispatch: Record<string, unknown> }; lines: { allocations?: { custom?: Record<string, unknown> }[] }[] }>(`select details, lines from tally_documents where document_type = 'sales-orders' and document_no = $1`, [no])).rows[0];

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
    products: schema.products,
    lookupItems: schema.lookupItems,
    productSkus: schema.productSkus,
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec("create sequence if not exists customer_masters_code_seq start 1");
  // What production has today: 0128 applied, 0130 not.
  for (const m of ["0122_tally_import.sql", "0127_sales_order_details.sql", "0128_sales_order_field_settings.sql"]) await pg.exec(MIGRATION(m));
  const one = async (sql: string, params: unknown[] = []) => (await pg.query<{ id: string }>(sql, params)).rows[0]!.id;
  for (const k of Object.keys(who) as (keyof typeof who)[]) who[k] = await one(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [k, `${k}@example.test`]);
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('sales-orders.fields.manage', 'employee', $1, true)`, [who.manager]);
  for (const k of ["root", "manager", "admin"] as const) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [who[k]]);
  await one(`insert into customer_masters (name, code, gstin) values ('Alpha Traders', '00001', '27ABCDE1234F1Z5') returning id`);
  const motor = await one(`insert into products (name, code) values ('Gear Motor', 'GM') returning id`);
  await one(`insert into product_skus (product_id, sku_code, variant_label, uom) values ($1, 'GM-1', '1 HP', 'Nos') returning id`, [motor]);
  fieldActions = await import("@/app/(masters)/master-setup/sales-order-fields/actions");
  importActions = await import("@/app/(forms-module)/forms/tally-import/actions");
  fieldsQ = await import("@/lib/queries/sales-order-fields");
}, 120_000);
afterAll(async () => {
  await pg.close();
});
beforeEach(() => signIn("root"));

describe("on a database with 0128 only (production today)", () => {
  it("nothing is seeded: the whole catalogue is there with no row, and help text is reported as not available", async () => {
    const l = await load();
    expect([l.ready, l.helpTextReady, l.settings.length, l.catalogue.version]).toEqual([true, false, 0, 0]);
    expect([l.catalogue.fields.length, l.catalogue.sectionList.length, l.catalogue.fields.filter((f) => f.status === "active").length]).toEqual([353, 38, 115]);
    expect(await counts()).toEqual({ s: 0, h: 0 });
  });

  it("section settings need the same permission as field settings", async () => {
    signIn("admin");
    await expect(saveSection({ name: "Order Details", label: "Customer's order" })).rejects.toThrow("Forbidden");
    await expect(saveField({ fieldKey: "motorVehicleNo", status: "active" })).rejects.toThrow("Forbidden");
    expect(await counts()).toEqual({ s: 0, h: 0 });
    signIn("manager");
    expect(await saveSection({ name: "Order Details", label: "Customer's order", displayOrder: 5 })).toMatchObject({ ok: true, fieldKey: "section_order_details" });
  });

  it("a section's label and order are stored in the settings table, versioned and in the history like a field's", async () => {
    expect(await row("section_order_details")).toMatchObject({ field_key: "section_order_details", is_custom: false, section: "Order Details", label: "Customer's order", display_order: 5, status: "active", row_version: 1, requirement: null, field_type: null });
    const c = await current();
    expect(c.version).toBe(1);
    expect(c.sectionByName.get("Order Details")).toMatchObject({ label: "Customer's order", displayOrder: 5, enabled: true, key: "section_order_details" });
    expect(c.sections[0]).toBe("Order Details");
    expect(await history("section_order_details")).toEqual([{ action: "create", before: null, after: expect.objectContaining({ fieldKey: "section_order_details", section: "Order Details", label: "Customer's order", displayOrder: 5, status: "active" }) }]);
    // A screen that read an older version is refused; the right one is saved as the next version.
    expect(await saveSection({ name: "Order Details", label: "Order", expectedRowVersion: 0 })).toEqual({ ok: false, error: expect.stringMatching(/changed by someone else meanwhile/) });
    const again = await saveSection({ name: "Order Details", label: "Order details (customer)", displayOrder: 5, expectedRowVersion: 1 });
    expect(again).toMatchObject({ ok: true, version: 2 });
    expect((await history("section_order_details")).map((r) => r.action)).toEqual(["create", "update"]);
    expect((await fieldsQ.listFieldHistory(5)).rows[0]).toMatchObject({ fieldKey: "section_order_details", action: "update", changedBy: "root" });
  });

  it("disabling a section writes one row and one history entry — no field row, no order — and switches its fields off; an always-on section is refused", async () => {
    const before = await counts();
    const off = await saveSection({ name: "Dispatch/Receipt/Party's Document Details", status: "retired" });
    expect(off).toMatchObject({ ok: true, fieldKey: "section_dispatch_receipt_party_s_document_details" });
    expect(await counts()).toEqual({ s: before.s + 1, h: before.h + 1 });
    const c = await current();
    expect(c.byKey.get("carrier")).toMatchObject({ status: "retired", ownStatus: "active", sectionOff: true });
    expect(templateHeadings(c)).not.toContain("Carrier Name/Agent");
    expect(await saveSection({ name: "General Details", status: "retired" })).toEqual({ ok: false, error: expect.stringMatching(/General Details can't be disabled\. It holds Voucher Type Name/) });
    expect(await saveSection({ name: "No such section" })).toEqual({ ok: false, error: "That section doesn't exist." });
    // Enabled again: the action is "restore", and the fields are back.
    expect(await saveSection({ name: "Dispatch/Receipt/Party's Document Details", status: "active", expectedRowVersion: 1 })).toMatchObject({ ok: true });
    expect((await history("section_dispatch_receipt_party_s_document_details")).map((r) => r.action)).toEqual(["create", "restore"]);
    expect((await current()).byKey.get("carrier")).toMatchObject({ status: "active", sectionOff: false });
  });

  it("a custom section is added by itself, can't take an existing section's name, and holds a custom field and a moved field", async () => {
    expect(await saveSection({ name: "Logistics", isNew: true })).toMatchObject({ ok: true, fieldKey: "section_logistics" });
    expect(await saveSection({ name: "Logistics", isNew: true })).toEqual({ ok: false, error: expect.stringMatching(/already a section called/) });
    expect(await saveSection({ name: "ledger details", isNew: true })).toEqual({ ok: false, error: expect.stringMatching(/already the name of another section/) });
    expect(await fieldActions.saveSalesOrderField(fieldInput({ isCustom: true, label: "Route", section: "Logistics", fieldType: "text", requirement: "optional" }))).toMatchObject({ ok: true, fieldKey: "custom_route" });
    expect(await saveField({ fieldKey: "destination", section: "Logistics" })).toMatchObject({ ok: true });
    const c = await current();
    expect(c.sectionByName.get("Logistics")).toMatchObject({ isCustom: true, enabled: true });
    expect(c.fields.filter((f) => String(f.section) === "Logistics").map((f) => f.key).sort()).toEqual(["custom_route", "destination"]);
    // A field's key can never be a section's, and the other way round.
    expect(await saveField({ fieldKey: "section_logistics", label: "x", expectedRowVersion: 1 })).toEqual({ ok: false, error: expect.stringMatching(/section's setting, not a field's/) });
  });

  it("a provision is enabled by one saved row; a repeating group's field can't be moved out of its section", async () => {
    const before = await counts();
    expect(SO_PROVISIONS.filter((p) => supportOf(p) === "needsWork")).toEqual([]);
    expect(await saveField({ fieldKey: "bankName", scope: "ledger", status: "active", section: "Order Details" })).toEqual({ ok: false, error: expect.stringMatching(/column of the Bank Allocations Details rows: it stays in that section/) });
    expect(await counts()).toEqual(before);
    for (const key of ["motorVehicleNo", "ewayBillNo"]) expect(await saveField({ fieldKey: key, status: "active" })).toMatchObject({ ok: true, fieldKey: key });
    expect(await saveField({ fieldKey: "tdsNatureOfPayment", scope: "ledger", status: "active" })).toMatchObject({ ok: true });
    expect(await saveField({ fieldKey: "allocBatchNo", scope: "allocation", status: "active", requirement: "mandatory" })).toMatchObject({ ok: true });
    expect(await row("motorVehicleNo")).toMatchObject({ is_custom: false, scope: "voucher", status: "active", label: null, section: null });
    const c = await current();
    expect(c.fields.filter((f) => f.defaultOff && f.status === "active").map((f) => f.key).sort()).toEqual(["allocBatchNo", "ewayBillNo", "motorVehicleNo", "tdsNatureOfPayment"]);
    // A disabled field's settings are still saved and kept.
    expect(await saveField({ fieldKey: "billName", scope: "ledger", label: "Bill reference", status: "retired" })).toMatchObject({ ok: true });
    expect((await current()).byKey.get("billName")).toMatchObject({ label: "Bill reference", status: "retired" });
  });

  it("an order imported under that configuration stores the enabled provisions with its order, ledger entry and delivery, and the mandatory one is enforced", async () => {
    signIn("admin");
    const c = await current();
    const missing = await importActions.checkTallyChunk({ category: "sales-orders", mapping: mappingOf(c), rows: orderRows(c, "SO/PR/0"), asOfDate: null, direction: null, fieldConfigVersion: c.version });
    expect(missing.ok && missing.rows.flatMap((r) => r.messages).join(" | ")).toMatch(/“Item Allocations - Batch\/Lot No\.”/);
    const data = orderRows(c, "SO/PR/1", { head: { motorVehicleNo: "MH12AB1234", ewayBillNo: "331001234567", tdsNatureOfPayment: "194Q", custom_route: "NH48" }, item: { allocBatchNo: "B-77" } });
    const done = await importOrder(c, data, c.version);
    expect(done.finished).toMatchObject({ ok: true, documents: 1 });
    const s = (await stored("SO/PR/1"))!;
    expect(s.details.custom).toEqual({ motorVehicleNo: "MH12AB1234", ewayBillNo: "331001234567", custom_route: "NH48" });
    expect(s.details.ledgers[0]!.custom).toEqual({ tdsNatureOfPayment: "194Q" });
    expect(s.lines[0]!.allocations![0]!.custom).toEqual({ allocBatchNo: "B-77" });
    expect(s.details.dispatch).toMatchObject({ destination: "Pune" }); // a field moved to a custom section is stored where it always was
  });

  it("disabling a field or a section never touches a stored order", async () => {
    const before = (await stored("SO/PR/1"))!;
    expect(await saveField({ fieldKey: "motorVehicleNo", status: "retired", expectedRowVersion: 1 })).toMatchObject({ ok: true });
    expect(await saveSection({ name: "e-Way Bill Details", status: "retired" })).toMatchObject({ ok: true });
    expect(await saveSection({ name: "Logistics", status: "retired", expectedRowVersion: 1 })).toMatchObject({ ok: true });
    expect(await stored("SO/PR/1")).toEqual(before);
    const c = await current();
    expect(templateHeadings(c)).not.toEqual(expect.arrayContaining(["Motor Vehicle No.", "e-Way Bill No.", "Route", "Destination"]));
    expect(c.byKey.get("ewayBillNo")).toMatchObject({ ownStatus: "active", status: "retired", sectionOff: true });
  });

  it("a section change saved while an import is running stops its remaining parts, like a field change", async () => {
    signIn("admin");
    const c = await current();
    const done = await importOrder(c, orderRows(c, "SO/PR/2", { item: { allocBatchNo: "B-78" } }), c.version, async () => {
      signIn("root");
      expect(await saveSection({ name: "Voucher Status", displayOrder: 400 })).toMatchObject({ ok: true });
      signIn("admin");
    });
    expect(done.started.ok).toBe(true);
    expect(done.chunks).toEqual([{ ok: false, error: expect.stringMatching(/validate again/) }]);
    expect(await stored("SO/PR/2")).toBeUndefined();
  });

  it("help text can't be saved yet — the save is refused whole and says which update is needed; every other setting still saves", async () => {
    const before = await counts();
    expect(await saveField({ fieldKey: "carrier", helpText: "The transporter's registered name." })).toEqual({ ok: false, error: "Help text needs database update 0130 first, so nothing was saved." });
    expect(await saveSection({ name: "Voucher Status", displayOrder: 400, helpText: "Tally's own voucher flags.", expectedRowVersion: 1 })).toEqual({ ok: false, error: "Help text needs database update 0130 first, so nothing was saved." });
    expect(await counts()).toEqual(before);
    // A blank help text asks for nothing: the rest of the setting is saved.
    expect(await saveField({ fieldKey: "carrier", label: "Transporter", helpText: null })).toMatchObject({ ok: true });
    expect(await saveField({ fieldKey: "carrier", label: "Transporter", helpText: "   ", expectedRowVersion: 1 })).toMatchObject({ ok: true });
    expect((await current()).byKey.get("carrier")).toMatchObject({ label: "Transporter", helpText: null });
    expect((await history("carrier")).at(-1)!.after).not.toHaveProperty("helpText");
  });
});

describe("repeating groups and the cash/trade discount through the real import (no migration needed)", () => {
  it("enabled by saved settings, an order's bill allocations, advance lines and cash/trade discount are stored in its JSON; re-checking it finds the exact duplicate", async () => {
    for (const key of ["billName", "billAmount", "advLedgerName", "advAmount", "cashTradeDiscRate"]) {
      const f = SO_PROVISIONS.find((p) => p.key === key)!;
      const version = Number((await row(key))?.row_version ?? 0); // billName already has a setting (an earlier test)
      expect(await saveField({ fieldKey: key, scope: scopeOfLevel(f.level), status: "active", expectedRowVersion: version }), key).toMatchObject({ ok: true });
    }
    expect(await saveField({ fieldKey: "billAmountDrCr", scope: "ledger", status: "active", requirement: "conditional", condition: { op: "given", field: "billAmount" } })).toMatchObject({ ok: true });
    signIn("admin");
    const c = await current();
    // 1 × ₹1,000 less 10% cash/trade = ₹900; the single delivery carries ₹1,000 (the value before it).
    const amounts = { amount: "900" };
    const line = { lineAmount: "900", taxableValue: "900", cashTradeDiscRate: "10", allocBatchNo: "B-1" };
    const data = orderRows(c, "SO/GR/1", { head: { ...amounts, billName: "INV-1", billAmount: "900", billAmountDrCr: "Dr" }, item: { ...amounts, ...line } });
    data.push({ rowNo: 4, cells: templateRow(c, { advLedgerName: "Advance received", advAmount: "250" }) });
    // Without its Dr/Cr, the bill allocation with an amount is refused (the condition), on its row.
    const bad = orderRows(c, "SO/GR/0", { head: { ...amounts, billName: "INV-1", billAmount: "900" }, item: { ...amounts, ...line } });
    const checked = await importActions.checkTallyChunk({ category: "sales-orders", mapping: mappingOf(c), rows: bad, asOfDate: null, direction: null, fieldConfigVersion: c.version });
    expect(checked.ok && checked.rows[0]!.messages.join(" ")).toMatch(/Required field is blank on this bill allocation: “Bill Amount - Dr\/Cr”/);

    const done = await importOrder(c, data, c.version);
    expect(done.finished).toMatchObject({ ok: true, documents: 1 });
    const doc = (await pg.query<{ details: Record<string, unknown> & { ledgers: { name: string; groups?: unknown }[]; groups?: unknown }; lines: { amountPaise: number; custom?: unknown; allocations: { amountPaise: number }[] }[]; total_paise: string }>(`select details, lines, total_paise from tally_documents where document_type = 'sales-orders' and document_no = 'SO/GR/1'`)).rows[0]!;
    expect(Number(doc.total_paise)).toBe(90000);
    expect(doc.details.ledgers[0]).toMatchObject({ name: "Alpha Traders", groups: { billAllocations: [{ rowNo: 2, values: { billName: "INV-1", billAmount: "900.00", billAmountDrCr: "Dr" } }] } });
    expect(doc.details.groups).toEqual({ advancePayments: [{ rowNo: 4, values: { advLedgerName: "Advance received", advAmount: "250.00" } }] });
    expect(doc.lines[0]).toMatchObject({ amountPaise: 90000, custom: { cashTradeDiscRate: "10" }, allocations: [expect.objectContaining({ amountPaise: 100000 })] });

    // The same order again — its rows in another order — is the exact duplicate of the stored one.
    const again = [data[0]!, data[2]!, data[1]!].map((r, i) => ({ rowNo: i + 2, cells: r.cells }));
    const re = await importActions.checkTallyChunk({ category: "sales-orders", mapping: mappingOf(c), rows: again, asOfDate: null, direction: null, fieldConfigVersion: c.version });
    expect(re.ok && re.rows.map((r) => r.state)).toEqual(["duplicate", "duplicate", "duplicate"]);
  });
});

describe("after migration 0130 (help text)", () => {
  let snapshot: unknown[];
  it("applying it — twice — adds one nullable column and changes no existing row", async () => {
    const rows = async () => (await pg.query(`select to_jsonb(s) - 'help_text' as r from sales_order_field_settings s order by field_key`)).rows;
    const hist = async () => (await pg.query(`select to_jsonb(x) as r from sales_order_field_history x order by version`)).rows;
    snapshot = await rows();
    const historyBefore = await hist();
    expect(snapshot.length).toBeGreaterThan(8); // field rows and section rows written before 0130 existed
    await pg.exec(MIGRATION("0130_sales_order_field_help_text.sql"));
    await pg.exec(MIGRATION("0130_sales_order_field_help_text.sql"));
    expect(await rows()).toEqual(snapshot);
    expect(await hist()).toEqual(historyBefore);
    const col = (await pg.query<{ data_type: string; is_nullable: string; column_default: string | null }>(`select data_type, is_nullable, column_default from information_schema.columns where table_name = 'sales_order_field_settings' and column_name = 'help_text'`)).rows;
    expect(col).toEqual([{ data_type: "text", is_nullable: "YES", column_default: null }]);
    expect((await pg.query<{ n: number }>(`select count(*)::int n from sales_order_field_settings where help_text is not null`)).rows[0]!.n).toBe(0);
    const checks = (await pg.query<{ conname: string }>(`select conname from pg_constraint where conrelid = 'sales_order_field_settings'::regclass and conname in ('sales_order_field_settings_help_text_check', 'sales_order_field_settings_section_row_check') order by 1`)).rows.map((r) => r.conname);
    expect(checks).toEqual(["sales_order_field_settings_help_text_check", "sales_order_field_settings_section_row_check"]);
    expect((await load()).helpTextReady).toBe(true);
  });

  it("the configuration is exactly what it was: same version, same sections, same fields on", async () => {
    const c = await current();
    expect(c.sectionByName.get("Order Details")).toMatchObject({ label: "Order details (customer)", displayOrder: 5 });
    expect(c.sectionByName.get("Logistics")).toMatchObject({ isCustom: true, enabled: false });
    expect(c.byKey.get("allocBatchNo")).toMatchObject({ status: "active", requirementRule: { kind: "always" } });
    expect(c.fields.every((f) => f.helpText === null)).toBe(true);
  });

  it("a field's and a section's help text are saved, read back, recorded in the history and cleared", async () => {
    const v = async (key: string) => Number((await row(key))!.row_version);
    expect(await saveField({ fieldKey: "carrier", label: "Transporter", helpText: "  The transporter's registered name.  ", expectedRowVersion: await v("carrier") })).toMatchObject({ ok: true });
    expect(await saveSection({ name: "Order Details", label: "Order details (customer)", displayOrder: 5, helpText: "From the customer's purchase order.", expectedRowVersion: await v("section_order_details") })).toMatchObject({ ok: true });
    expect((await row("carrier"))!.help_text).toBe("The transporter's registered name.");
    const c = await current();
    expect(c.byKey.get("carrier")!.helpText).toBe("The transporter's registered name.");
    expect(c.sectionByName.get("Order Details")!.helpText).toBe("From the customer's purchase order.");
    expect((await history("carrier")).at(-1)).toMatchObject({ action: "update", before: expect.objectContaining({ helpText: null }), after: expect.objectContaining({ helpText: "The transporter's registered name." }) });
    // A save that says nothing about help text keeps it; null clears it.
    expect(await saveField({ fieldKey: "carrier", label: "Carrier", expectedRowVersion: await v("carrier") })).toMatchObject({ ok: true });
    expect((await current()).byKey.get("carrier")).toMatchObject({ label: "Carrier", helpText: "The transporter's registered name." });
    expect(await saveField({ fieldKey: "carrier", label: "Carrier", helpText: null, expectedRowVersion: await v("carrier") })).toMatchObject({ ok: true });
    expect((await row("carrier"))!.help_text).toBeNull();
    // A provision's help text, with its enabling, in one save.
    expect(await saveField({ fieldKey: "portCode", status: "active", helpText: "The customs port code on the shipping bill." })).toMatchObject({ ok: true });
    expect((await current()).byKey.get("portCode")).toMatchObject({ status: "active", helpText: "The customs port code on the shipping bill." });
  });

  it("the server and the database both refuse a help text over 500 characters, and a section row without its section", async () => {
    expect(await saveField({ fieldKey: "narration", helpText: "x".repeat(501) })).toMatchObject({ ok: false });
    await expect(pg.query(`update sales_order_field_settings set help_text = repeat('x', 501) where field_key = 'carrier'`)).rejects.toThrow(/help_text_check/);
    await expect(pg.query(`update sales_order_field_settings set help_text = '   ' where field_key = 'carrier'`)).rejects.toThrow(/help_text_check/);
    await expect(pg.query(`insert into sales_order_field_settings (field_key, scope) values ('section_orphan', 'voucher')`)).rejects.toThrow(/section_row_check/);
    await expect(pg.query(`insert into sales_order_field_settings (field_key, scope, section, requirement) values ('section_ruled', 'voucher', 'Ruled', 'mandatory')`)).rejects.toThrow(/section_row_check/);
    // 0128's rules still hold for section rows: never deleted.
    await expect(pg.query(`delete from sales_order_field_settings where field_key = 'section_logistics'`)).rejects.toThrow(/never deleted/);
  });
});
