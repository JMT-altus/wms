import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite, running migration 0122's own SQL) for the Sales Order Excel import, through
// the real server actions. Invented data only. Nothing here can reach a shared or production database; only the
// session is mocked.
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
import type { SalesOrderLinks } from "@/lib/tally/sales-order-match";
import { SO_HEADERS, SO_MAPPING, soEntry, soLine, soRow, soVoucher, type SoCells } from "../fixtures/sales-order-rows";
import { emptySalesOrder, salesOrderFormLinks, salesOrderFormRows } from "@/lib/tally/sales-order-form";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let actions: typeof import("@/app/(forms-module)/forms/tally-import/actions");
let queries: typeof import("@/lib/queries/tally-import");
let fieldsQ: typeof import("@/lib/queries/sales-order-fields");
/** The current Sales Order field configuration version, which the browser sends with an import (0 = none saved). */
const fcv = async () => (await fieldsQ.loadSalesOrderCatalogue()).catalogue.version;
let grantee: string;
let other: string;
const id: Record<string, string> = {};

// The import template's layout: every field of Tally's Sales Order matrix, every Y field filled by the helpers
// (tests/fixtures/sales-order-rows.ts), so each test changes only what it is about.
const H = SO_HEADERS;
const M = SO_MAPPING;
type Cells = SoCells;
const cells = (c: Cells): string[] => soRow(c);
const head = (no: string, party: string, total: string, over: Cells = {}) =>
  cells({ documentDate: "01-04-2026", documentNo: no, partyName: party, amount: total, drCr: "Dr", ...soVoucher(party), ...soEntry, orderDate: over.documentDate ?? "01-04-2026", ...(over.itemName ? soLine(over.lineAmount ?? "") : {}), ...over });
const item = (name: string, qty: string, rate: string, amount: string, over: Cells = {}) => cells({ partyName: "Sales", amount, drCr: "Cr", ...soEntry, itemName: name, quantity: qty, rate, lineAmount: amount, ...soLine(amount), ...over });
const more = (name: string, qty: string, rate: string, amount: string, over: Cells = {}) => cells({ itemName: name, quantity: qty, rate, lineAmount: amount, ...soLine(amount), ...over });
const ledger = (name: string, amount: string, side = "Cr") => cells({ partyName: name, amount, drCr: side, ...soEntry });
const rows = (...r: string[][]): RawRow[] => r.map((c, i) => ({ rowNo: i + 2, cells: c }));

const TODAY = "2026-10-31";
let seq = 0;
const hash = () => String(++seq).padStart(64, "0");
const count = async (t: string, where = "true") => (await pg.query<{ n: number }>(`select count(*)::int as n from ${t} where ${where}`)).rows[0]!.n;
const order = async (no: string) => (await pg.query<Record<string, unknown> & { lines: Record<string, unknown>[] }>(`select * from tally_documents where document_type = 'sales-orders' and document_no = $1`, [no])).rows;
const audit = async (batchId: string) => (await pg.query<{ row_no: number; status: string; reason: string | null; target_id: string | null }>(`select row_no, status, reason, target_id from tally_import_rows where batch_id = $1 order by row_no`, [batchId])).rows;

const check = (data: RawRow[], links?: SalesOrderLinks) => actions.checkTallyChunk({ category: "sales-orders", mapping: M, rows: data, asOfDate: null, direction: null, ...(links ? { links } : {}) });

/** The whole browser flow against the real actions: start, send each part, finish. */
async function run(data: RawRow[], over: { fileHash?: string; fileName?: string; links?: SalesOrderLinks; includeAttention?: boolean } = {}) {
  const started = await actions.startTallyImport({ fieldConfigVersion: await fcv(), category: "sales-orders", fileName: over.fileName ?? "orders.xlsx", fileHash: over.fileHash ?? hash(), sheetName: "Accounting Voucher", headers: H, sample: data.slice(0, 20), mapping: M, totalRows: data.length, asOfDate: null, direction: null, includeAttention: over.includeAttention ?? false, confirm: true });
  if (!started.ok) return { started, batch: null, documents: 0, chunks: [] as unknown[] };
  const plan = planRows("sales-orders", data, M, { today: TODAY });
  const chunks = [];
  for (const c of chunkRows(data.filter((r) => !started.doneRowNos.includes(r.rowNo)), plan.rows)) chunks.push(await actions.importTallyChunk({ fieldConfigVersion: await fcv(), batchId: started.batchId, rows: c, ...(over.links ? { links: over.links } : {}) }));
  const done = await actions.finishTallyImport(started.batchId);
  return { started, batch: done.ok ? done.batch : null, documents: done.ok ? done.documents : 0, chunks };
}

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
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0122_tally_import.sql"), "utf8"));
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0127_sales_order_details.sql"), "utf8"));
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0128_sales_order_field_settings.sql"), "utf8"));
  const one = async (sql: string, params: unknown[] = []) => (await pg.query<{ id: string }>(sql, params)).rows[0]!.id;
  const emp = (name: string) => one(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [name, `${name}@example.test`]);
  grantee = await emp("granted");
  other = await emp("other");
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [grantee]);
  id.alpha = await one(`insert into customer_masters (name, code, gstin) values ('Alpha Traders', '00001', '27ABCDE1234F1Z5') returning id`);
  id.beta = await one(`insert into customer_masters (name, code) values ('Beta Corp', '00002') returning id`);
  id.motor = await one(`insert into products (name, code) values ('Gear Motor', 'GM') returning id`);
  id.box = await one(`insert into products (name, code) values ('Helical Gearbox', 'HG') returning id`);
  id.sku1 = await one(`insert into product_skus (product_id, sku_code, variant_label, uom, tally_item_name) values ($1, 'GM-1HP', '1 HP', 'Nos', 'Gear Motor 1HP B3') returning id`, [id.motor]);
  id.sku2 = await one(`insert into product_skus (product_id, sku_code, variant_label, uom) values ($1, 'GM-2HP', '2 HP', 'Nos') returning id`, [id.motor]);
  actions = await import("@/app/(forms-module)/forms/tally-import/actions");
  queries = await import("@/lib/queries/tally-import");
  fieldsQ = await import("@/lib/queries/sales-order-fields");
}, 120_000);
afterAll(async () => {
  await pg.close();
});
beforeEach(() => {
  h.me = { id: grantee, email: "granted@example.test", name: "granted", isActive: true, isAdmin: true, departmentId: null };
});

describe("importing", () => {
  it("1 · 2 · a multi-product order becomes ONE sales order with every line, linked to its customer and products, traceable to its file", async () => {
    const data = rows(head("SO/100", "Alpha Traders", "11800", { referenceNo: "PO-77" }), item("Gear Motor 1HP B3", "10", "400", "4000", { dueDate: "20-04-2026" }), more("HG", "3", "2000", "6000", { dueDate: "15-04-2026" }), ledger("Output IGST 18%", "1800"));
    const checked = await check(data);
    expect(checked.ok && checked.rows.map((r) => r.state)).toEqual(["valid", "valid", "valid", "valid"]);
    expect(checked.ok && checked.matches).toMatchObject({ customers: [{ name: "Alpha Traders", status: "matched", ref: id.alpha }], products: [{ name: "Gear Motor 1HP B3", status: "matched", ref: `sku:${id.sku1}` }, { name: "HG", status: "matched", ref: `product:${id.box}` }] });
    expect(await count("tally_documents", "document_no = 'SO/100'")).toBe(0); // validating writes nothing

    const { batch, documents } = await run(data, { fileName: "april.xlsx" });
    expect(batch).toMatchObject({ status: "completed", category: "sales-orders", fileName: "april.xlsx", totalRows: 4, importedRows: 4, skippedRows: 0, rejectedRows: 0, failedRows: 0, financialYears: ["2026-27"] });
    expect(documents).toBe(1);
    const stored = await order("SO/100");
    expect(stored).toHaveLength(1);
    const d = stored[0]!;
    expect(d).toMatchObject({ document_type: "sales-orders", financial_year: "2026-27", party_name: "Alpha Traders", customer_master_id: id.alpha, reference_no: "PO-77", adjustment_type: "Sales Order", import_batch_id: batch!.id, source_row: 2 });
    // The earliest line due date is the order's.
    expect((await pg.query<{ due: string }>(`select due_date::text as due from tally_documents where id = $1`, [d.id])).rows[0]!.due).toBe("2026-04-15");
    expect([Number(d.total_paise), Number(d.taxable_paise)]).toEqual([1180000, 1000000]);
    expect(d.lines).toEqual([
      expect.objectContaining({ item: "Gear Motor 1HP B3", quantity: 10, ratePaise: 40000, amountPaise: 400000, uom: "Nos", description: "Standard", dueDate: "2026-04-20", rowNo: 3, productId: id.motor, skuId: id.sku1, productLabel: "Gear Motor · 1 HP (GM-1HP)" }),
      expect.objectContaining({ item: "HG", quantity: 3, ratePaise: 200000, amountPaise: 600000, uom: "Nos", description: "Standard", dueDate: "2026-04-15", rowNo: 4, productId: id.box, skuId: null, productLabel: "Helical Gearbox (HG)" }),
    ]);
    // Each line keeps its allocation, GST and HSN/SAC; the order keeps every order-level field (migration 0127).
    expect(d.lines[0]).toMatchObject({ allocations: [{ quantity: 10, amountPaise: 400000, dueDate: "2026-04-20" }], gst: { rateDetails: "As per Masters/Company", taxablePaise: 400000 }, hsn: { details: "As per Masters/Company" } });
    const details = (await pg.query<{ details: Record<string, unknown> }>(`select details from tally_documents where id = $1`, [d.id])).rows[0]!.details;
    expect(details).toMatchObject({
      version: 1,
      voucher: { typeName: "Sales Order", narration: "Test order", costCentreClass: "Primary Cost Category", gstRegistration: "Test Registration" },
      order: { orderNos: "PO-77", orderDate: "2026-04-01", paymentTerms: "30 days", deliveryTerms: "Ex-works" },
      dispatch: { dispatchedThrough: "Road", destination: "Pune", carrier: "Test Transport" },
      buyer: { billTo: "Alpha Traders", state: "Maharashtra", registrationType: "Unregistered/Consumer", placeOfSupply: "Maharashtra", pincode: "411001" },
      consignee: { sameAsBuyer: true, billTo: "Alpha Traders" },
      supplyType: "Goods",
      states: { optional: false, postDated: false, cancelled: false, changeMode: "Item Invoice" },
    });
    expect((details.ledgers as { name: string; isParty: boolean; amountPaise: number; listedAs?: string | null }[]).map((l) => [l.name, l.isParty, l.amountPaise])).toEqual([["Alpha Traders", true, 1180000], ["Sales", false, 400000], ["Output IGST 18%", false, 180000]]); // each entry as the file wrote it
    // Every row of the order points at the one document it made.
    const rowsOf = await audit(batch!.id);
    expect(rowsOf.map((r) => [r.row_no, r.status, r.target_id])).toEqual([2, 3, 4, 5].map((n) => [n, "imported", d.id]));
  });

  it("3 · 4 · several customers and vouchers in one file are separate orders, each whole", async () => {
    const data = rows(head("SO/201", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000"), head("SO/202", "Beta Corp", "3000"), item("GM-2HP", "1", "1000", "1000"), more("Gear Motor 1HP B3", "2", "1000", "2000"), head("SO/203", "alpha traders", "500"), item("Helical Gearbox", "1", "500", "500"));
    const { batch, documents } = await run(data);
    expect(batch).toMatchObject({ status: "completed", importedRows: 7 });
    expect(documents).toBe(3);
    const got = await pg.query<{ document_no: string; customer_master_id: string; n: number }>(`select document_no, customer_master_id, jsonb_array_length(lines) as n from tally_documents where document_no in ('SO/201','SO/202','SO/203') order by 1`);
    expect(got.rows).toEqual([{ document_no: "SO/201", customer_master_id: id.alpha, n: 1 }, { document_no: "SO/202", customer_master_id: id.beta, n: 2 }, { document_no: "SO/203", customer_master_id: id.alpha, n: 1 }]);
  });

  it("5 · a flattened file (the voucher repeated on every row) is still one order per voucher", async () => {
    const flat = (no: string, total: string, name: string, amount: string) => head(no, "Beta Corp", total, { itemName: name, quantity: "1", rate: amount, ratePer: "Nos", lineAmount: amount });
    const { documents } = await run(rows(flat("SO/301", "3000", "GM-1HP", "1000"), flat("SO/301", "3000", "GM-2HP", "2000"), flat("SO/302", "700", "HG", "700")));
    expect(documents).toBe(2);
    expect((await order("SO/301"))[0]!.lines.map((l) => l.skuId)).toEqual([id.sku1, id.sku2]);
  });
});

describe("customers and products that the masters don't know", () => {
  const before = async () => [await count("customer_masters"), await count("products"), await count("product_skus")];

  it("8 · an unknown customer: the order is refused whole, nothing is created, and validation says where", async () => {
    const masters = await before();
    const data = rows(head("SO/401", "Nobody Industries", "1000"), item("GM-1HP", "1", "1000", "1000"));
    const checked = await check(data);
    expect(checked.ok && checked.rows.map((r) => [r.rowNo, r.state, r.messages[0]])).toEqual([
      [2, "invalid", `"Nobody Industries" isn't in the Customer Master. Match it under Match customers and items, or add the customer first.`],
      [3, "invalid", "Not imported: row 2 of this order has an error."],
    ]);
    expect(checked.ok && checked.matches!.customers).toEqual([{ key: "nobodyindustries", name: "Nobody Industries", status: "unmatched", label: null, ref: null, rows: [2] }]);
    const { batch, documents } = await run(data);
    expect(batch).toMatchObject({ status: "completed", importedRows: 0, rejectedRows: 2 });
    expect(documents).toBe(0);
    expect(await order("SO/401")).toEqual([]);
    expect(await before()).toEqual(masters);
  });

  it("9 · an unknown item: the whole order waits — the matched lines are not imported without it", async () => {
    const masters = await before();
    const data = rows(head("SO/402", "Alpha Traders", "3000"), item("GM-1HP", "1", "1000", "1000"), more("Mystery Motor", "1", "2000", "2000"));
    const checked = await check(data);
    expect(checked.ok && checked.rows.map((r) => [r.rowNo, r.state])).toEqual([[2, "invalid"], [3, "invalid"], [4, "invalid"]]);
    expect(checked.ok && checked.rows[2]!.messages[0]).toMatch(/"Mystery Motor" isn't in the Product Master/);
    expect(checked.ok && checked.rows[0]!.messages).toEqual(["Not imported: row 4 of this order has an error."]);
    const { batch, documents } = await run(data);
    expect([batch!.importedRows, batch!.rejectedRows, documents]).toEqual([0, 3, 0]);
    expect(await order("SO/402")).toEqual([]);
    expect((await audit(batch!.id)).map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(await before()).toEqual(masters);
  });

  it("a person with the permission matches the names; the match is checked, used, and written into the history", async () => {
    const masters = await before();
    const data = rows(head("SO/403", "Nobody Industries", "3000"), item("GM-1HP", "1", "1000", "1000"), more("Mystery Motor", "1", "2000", "2000"));
    const links: SalesOrderLinks = { customers: { nobodyindustries: id.beta! }, products: { mysterymotor: `sku:${id.sku2}` } };
    const checked = await check(data, links);
    expect(checked.ok && checked.rows.map((r) => r.state)).toEqual(["valid", "valid", "valid"]);
    expect(checked.ok && checked.matches).toMatchObject({ customers: [{ status: "manual", label: "Beta Corp · 00002" }], products: [{ status: "matched" }, { status: "manual", label: "Gear Motor · 2 HP (GM-2HP)" }] });
    const { batch, documents } = await run(data, { links });
    expect([batch!.status, batch!.importedRows, documents]).toEqual(["completed", 3, 1]);
    const d = (await order("SO/403"))[0]!;
    // The file's own name is kept; the link is to the master record the person chose.
    expect(d).toMatchObject({ party_name: "Nobody Industries", customer_master_id: id.beta });
    expect(d.lines.map((l) => [l.item, l.skuId])).toEqual([["GM-1HP", id.sku1], ["Mystery Motor", id.sku2]]);
    expect((await audit(batch!.id))[0]!.reason).toBe(`Customer "Nobody Industries" was matched by hand to "Beta Corp · 00002". Item "Mystery Motor" was matched by hand to "Gear Motor · 2 HP (GM-2HP)".`);
    expect(await before()).toEqual(masters); // matching never adds to or edits a master
  });

  it("a match can't override what the masters already say, and one that points at nothing is not a match", async () => {
    const exact = rows(head("SO/404", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000"));
    await run(exact, { links: { customers: { alphatraders: id.beta! }, products: { gm1hp: `sku:${id.sku2}` } } });
    const d = (await order("SO/404"))[0]!;
    expect(d.customer_master_id).toBe(id.alpha);
    expect(d.lines[0]!.skuId).toBe(id.sku1);
    const ghost = "00000000-0000-4000-8000-000000000000";
    const checked = await check(rows(head("SO/405", "Nobody Industries", "1000"), item("GM-1HP", "1", "1000", "1000")), { customers: { nobodyindustries: ghost }, products: {} });
    expect(checked.ok && checked.rows[0]!.state).toBe("invalid");
  });

  it("a unit that differs from the Product Master is a warning: imported only with the opt-in", async () => {
    const data = rows(head("SO/406", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000", { ratePer: "Kg" }));
    const checked = await check(data);
    expect(checked.ok && checked.rows.map((r) => r.state)).toEqual(["valid", "attention"]);
    const held = await run(data);
    expect([held.batch!.importedRows, held.batch!.skippedRows, held.documents]).toEqual([0, 2, 0]);
    const taken = await run(data, { includeAttention: true });
    expect([taken.batch!.importedRows, taken.documents]).toEqual([2, 1]);
  });
});

describe("duplicates and conflicts", () => {
  const a = () => [head("SO/501", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000")];

  it("14 · a voucher repeated inside one file is imported once", async () => {
    const { batch, documents } = await run(rows(...a(), head("SO/502", "Beta Corp", "500"), item("HG", "1", "500", "500"), ...a()));
    expect(documents).toBe(2);
    expect(batch).toMatchObject({ status: "completed", importedRows: 4, skippedRows: 2 });
    expect(await order("SO/501")).toHaveLength(1);
    expect((await order("SO/501"))[0]!.lines).toHaveLength(1);
    expect((await audit(batch!.id)).slice(4).map((r) => [r.status, r.reason])).toEqual([["skipped", "Repeats row 2 of this file."], ["skipped", "Repeats row 2 of this file."]]);
  });

  it("15 · an order already in the WMS is skipped, whatever the file is called, and stays exactly as it was", async () => {
    const stored = (await order("SO/501"))[0]!;
    const checked = await check(rows(...a()));
    expect(checked.ok && checked.rows.map((r) => [r.state, r.messages[0]])).toEqual([["duplicate", "Already in Sales Orders; skipped."], ["duplicate", "Already in Sales Orders; skipped."]]);
    const { batch, documents } = await run(rows(...a()), { fileName: "renamed.xlsx" });
    expect([batch!.importedRows, batch!.skippedRows, documents]).toEqual([0, 2, 0]);
    expect((await order("SO/501"))[0]).toEqual(stored);
  });

  it("16 · the same voucher number for another customer, or with other lines or another total, is refused for review and never overwrites", async () => {
    const stored = (await order("SO/501"))[0]!;
    const cases: [RawRow[], RegExp][] = [
      [rows(head("SO/501", "Beta Corp", "1000"), item("GM-1HP", "1", "1000", "1000")), /already in Sales Orders with a different customer/],
      [rows(head("SO/501", "Alpha Traders", "1000"), item("GM-2HP", "1", "1000", "1000")), /with different product lines/],
      [rows(head("SO/501", "Alpha Traders", "2000"), item("GM-1HP", "2", "1000", "2000")), /with a different total \(₹1000\.00\)/],
      [rows(head("SO/501", "Alpha Traders", "1000", { documentDate: "02-04-2026" }), item("GM-1HP", "1", "1000", "1000")), /with a different date \(2026-04-01\)/],
    ];
    for (const [data, why] of cases) {
      const checked = await check(data);
      expect(checked.ok && checked.rows[0]).toMatchObject({ state: "invalid" });
      expect(checked.ok && checked.rows[0]!.messages[0]).toMatch(why);
      expect(checked.ok && checked.rows[0]!.messages[0]).toMatch(/never overwritten/);
      const { batch, documents } = await run(data);
      expect([batch!.importedRows, batch!.rejectedRows, documents]).toEqual([0, 2, 0]);
    }
    expect(await order("SO/501")).toEqual([stored]);
  });

  it("conflicting customers for one voucher number inside a file: the first is imported, the second refused, nothing merged", async () => {
    const { batch, documents } = await run(rows(head("SO/510", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000"), head("SO/511", "Beta Corp", "500"), item("HG", "1", "500", "500"), head("SO/510", "Beta Corp", "1000"), item("GM-1HP", "1", "1000", "1000")));
    expect(documents).toBe(2);
    expect([batch!.importedRows, batch!.rejectedRows]).toEqual([4, 2]);
    const d = await order("SO/510");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ party_name: "Alpha Traders", customer_master_id: id.alpha });
    expect((await audit(batch!.id))[4]!.reason).toMatch(/Same voucher number as row 2, but a different customer/);
  });

  it("the same number in another financial year is another order", async () => {
    const { documents } = await run(rows(head("SO/501", "Alpha Traders", "1000", { documentDate: "31-03-2026" }), item("GM-1HP", "1", "1000", "1000")));
    expect(documents).toBe(1);
    expect((await order("SO/501")).map((d) => d.financial_year).sort()).toEqual(["2025-26", "2026-27"]);
  });
});

describe("permissions and bad input", () => {
  const data = () => rows(head("SO/601", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000"));

  it("17 · without the import permission nothing can be validated, matched, started, written or finished — admin or not", async () => {
    h.me = { id: other, email: "other@example.test", name: "other", isActive: true, isAdmin: true, departmentId: null };
    await expect(check(data())).rejects.toThrow("Forbidden");
    await expect(check(data(), { customers: { x: id.alpha! }, products: {} })).rejects.toThrow("Forbidden");
    await expect(actions.startTallyImport({})).rejects.toThrow("Forbidden");
    await expect(actions.importTallyChunk({})).rejects.toThrow("Forbidden");
    await expect(actions.finishTallyImport("x")).rejects.toThrow("Forbidden");
    h.me = { id: grantee, email: "granted@example.test", name: "granted", isActive: true, isAdmin: false, departmentId: null };
    await expect(check(data())).rejects.toThrow("Forbidden"); // the grant alone, without admin, is not enough
    h.me = null;
    await expect(check(data())).rejects.toThrow("Forbidden");
    expect(await order("SO/601")).toEqual([]);
  });

  it("one person can't write into another person's import", async () => {
    const started = await actions.startTallyImport({ fieldConfigVersion: await fcv(), category: "sales-orders", fileName: "a.xlsx", fileHash: hash(), sheetName: null, headers: H, sample: data(), mapping: M, totalRows: 2, asOfDate: null, direction: null, includeAttention: false, confirm: true });
    expect(started.ok).toBe(true);
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [other]);
    h.me = { id: other, email: "other@example.test", name: "other", isActive: true, isAdmin: true, departmentId: null };
    expect(await actions.importTallyChunk({ fieldConfigVersion: await fcv(), batchId: (started as { batchId: string }).batchId, rows: data() })).toEqual({ ok: false, error: "That import wasn't found." });
    await pg.query(`delete from field_permission_grants where subject_id = $1`, [other]);
    expect(await order("SO/601")).toEqual([]);
  });

  it("malformed requests are refused without touching the database or leaking its errors", async () => {
    const bad = { ok: false, error: "That data couldn't be read." };
    expect(await check(data(), { customers: { x: "not-an-id" }, products: {} } as SalesOrderLinks)).toEqual(bad);
    expect(await check(data(), { customers: {}, products: { x: `sku:${id.sku1}; drop table products` } })).toEqual(bad);
    expect(await actions.checkTallyChunk({ category: "sales-orders", mapping: M, rows: [{ rowNo: 0, cells: [] }], asOfDate: null, direction: null })).toEqual(bad);
    expect(await actions.checkTallyChunk({ category: "sales-orders", mapping: M, rows: [{ rowNo: 2, cells: ["x".repeat(600)] }], asOfDate: null, direction: null })).toEqual(bad);
    expect(await actions.checkTallyChunk({ category: "sales-orders", mapping: { ...M, totalPaise: 0 }, rows: data(), asOfDate: null, direction: null })).toEqual({ ok: false, error: "The column mapping isn't valid for this category." });
    // Amounts and ids are never taken from the browser: an "extra" field on a row is refused outright.
    expect(await actions.checkTallyChunk({ category: "sales-orders", mapping: M, rows: [{ rowNo: 2, cells: data()[0]!.cells, customerMasterId: id.beta }], asOfDate: null, direction: null })).toEqual(bad);
    const incomplete = await actions.startTallyImport({ fieldConfigVersion: await fcv(), category: "sales-orders", fileName: "a.xlsx", fileHash: hash(), sheetName: null, headers: H, sample: data(), mapping: { documentNo: M.documentNo!, documentDate: M.documentDate!, partyName: M.partyName!, amount: M.amount! }, totalRows: 2, asOfDate: null, direction: null, includeAttention: false, confirm: true });
    expect(incomplete).toEqual({ ok: false, error: expect.stringMatching(/mapping isn't complete/) });
    const unconfirmed = await actions.startTallyImport({ fieldConfigVersion: await fcv(), category: "sales-orders", fileName: "a.xlsx", fileHash: hash(), sheetName: null, headers: H, sample: data(), mapping: M, totalRows: 2, asOfDate: null, direction: null, includeAttention: false });
    expect(unconfirmed.ok).toBe(false);
    expect(await order("SO/601")).toEqual([]);
  });
});

describe("failures, retries and the history", () => {
  it("18 · 19 · a save that fails leaves no partial order; uploading the same file again finishes it, once", async () => {
    const fileHash = hash();
    const data = rows(head("SO/701", "Alpha Traders", "3000"), item("GM-1HP", "1", "1000", "1000"), more("GM-2HP", "1", "2000", "2000"), head("SO/702", "Beta Corp", "500"), item("HG", "1", "500", "500"));
    // The second order can't be stored. Both travel in one part, which is one transaction.
    await pg.exec("alter table tally_documents add constraint block check (document_no <> 'SO/702')");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await run(data, { fileHash });
    err.mockRestore();
    expect(failed.chunks).toEqual([{ ok: false, error: "Part of the file couldn't be saved." }]);
    expect(failed.batch).toMatchObject({ status: "failed", importedRows: 0, failedRows: 5 });
    expect(failed.documents).toBe(0);
    expect(await count("tally_documents", "document_no in ('SO/701','SO/702')")).toBe(0); // not even the order that could have been saved
    await pg.exec("alter table tally_documents drop constraint block");

    const retried = await run(data, { fileHash });
    expect(retried.started).toMatchObject({ ok: true, resumed: true, batchId: failed.batch!.id, doneRowNos: [] });
    expect(retried.batch).toMatchObject({ id: failed.batch!.id, status: "completed", importedRows: 5, failedRows: 0 });
    expect(retried.documents).toBe(2);
    expect((await order("SO/701"))[0]!.lines).toHaveLength(2);

    // Sending the same part twice, and uploading the finished file a third time, add nothing.
    const again = await run(data, { fileHash });
    expect(again.started).toMatchObject({ ok: true, resumed: false });
    expect(again.batch).toMatchObject({ status: "completed", importedRows: 0, skippedRows: 5 });
    expect(again.documents).toBe(0);
    expect(await count("tally_documents", "document_no in ('SO/701','SO/702')")).toBe(2);
    expect(await count("tally_import_rows", `batch_id = '${retried.batch!.id}'`)).toBe(5);
  });

  it("an interrupted import carries on from where it stopped", async () => {
    const fileHash = hash();
    const data = rows(head("SO/711", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000"), head("SO/712", "Beta Corp", "500"), item("HG", "1", "500", "500"));
    const first = await actions.startTallyImport({ fieldConfigVersion: await fcv(), category: "sales-orders", fileName: "x.xlsx", fileHash, sheetName: null, headers: H, sample: data, mapping: M, totalRows: 4, asOfDate: null, direction: null, includeAttention: false, confirm: true });
    const batchId = (first as { batchId: string }).batchId;
    await actions.importTallyChunk({ fieldConfigVersion: await fcv(), batchId, rows: data.slice(0, 2) });
    await actions.importTallyChunk({ fieldConfigVersion: await fcv(), batchId, rows: data.slice(0, 2) }); // the browser retried the part
    // The browser dies here.
    const resumed = await run(data, { fileHash });
    expect(resumed.started).toMatchObject({ resumed: true, batchId, doneRowNos: [2, 3] });
    expect(resumed.batch).toMatchObject({ status: "completed", importedRows: 4 });
    expect(resumed.documents).toBe(2);
    expect(await count("tally_documents", "document_no in ('SO/711','SO/712')")).toBe(2);
    expect(await count("tally_import_rows", `batch_id = '${batchId}'`)).toBe(4);
  });

  it("20 · the history is the Sales Order imports only, with the file, the person, the time, the totals and the status, counted from the database", async () => {
    const mixed = rows(head("SO/801", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000"), head("SO/802", "Nobody Industries", "500"), item("HG", "1", "500", "500"), head("SO/801", "Alpha Traders", "1000"), item("GM-1HP", "1", "1000", "1000"));
    const { batch } = await run(mixed, { fileName: "history.xlsx" });
    const { storageReady, rows: history } = await queries.listHistory(50, "sales-orders");
    expect(storageReady).toBe(true);
    expect(history.every((b) => b.category === "sales-orders")).toBe(true);
    const mine = history.find((b) => b.id === batch!.id)!;
    expect(mine).toMatchObject({ fileName: "history.xlsx", uploadedBy: "granted", status: "completed", totalRows: 6, importedRows: 2, skippedRows: 2, rejectedRows: 2, failedRows: 0, documentCount: 1 });
    expect(mine.createdAt).toBeInstanceOf(Date);
    expect(mine.completedAt).toBeInstanceOf(Date);
    // The totals are the recorded rows and the stored documents, not what the browser reported.
    const byStatus = await pg.query<{ status: string; n: number }>(`select status, count(*)::int as n from tally_import_rows where batch_id = $1 group by status order by status`, [batch!.id]);
    expect(byStatus.rows).toEqual([{ status: "imported", n: 2 }, { status: "rejected", n: 2 }, { status: "skipped", n: 2 }]);
    expect(await count("tally_documents", `import_batch_id = '${batch!.id}'`)).toBe(1);
    expect((await actions.getTallyBatchProblems(batch!.id)).map((p) => [p.rowNo, p.status])).toEqual([[4, "rejected"], [5, "rejected"], [6, "skipped"], [7, "skipped"]]);
    // The general history still lists every category.
    expect((await queries.listHistory()).rows.some((b) => b.id === batch!.id)).toBe(true);
  });

  it("the match lists offer every customer and every active item, and nothing else", async () => {
    await pg.query(`insert into products (name, is_active) values ('Retired Pump', false)`);
    const options = await queries.salesOrderLinkOptions();
    expect(options.customers.map((c) => c.label)).toEqual(["Alpha Traders · 00001", "Beta Corp · 00002"]);
    expect(Object.fromEntries(options.products.map((p) => [p.value, p.label]))).toEqual({
      [`product:${id.motor}`]: "Gear Motor (GM) — whole product",
      [`sku:${id.sku1}`]: "Gear Motor · 1 HP (GM-1HP)",
      [`sku:${id.sku2}`]: "Gear Motor · 2 HP (GM-2HP)",
      [`product:${id.box}`]: "Helical Gearbox (HG) — whole product",
    });
  });

  it("an import never touched the masters or any other kind of document", async () => {
    expect(await count("customer_masters")).toBe(2);
    expect(await count("product_skus")).toBe(2);
    expect(await count("tally_documents", "document_type <> 'sales-orders'")).toBe(0);
    const src = readFileSync(resolve(__dirname, "../../lib/queries/tally-import.ts"), "utf8");
    expect(src).not.toMatch(/\.(insert|update|delete)\((products|productSkus|salesOrders)\b/);
  });
});

describe("the full Tally Sales Order field set, through the real actions", () => {
  it("a separate consignee, ledger rates and narrations, GST and HSN/SAC are all stored with the order", async () => {
    const consignee = { consignee: "Site Office", consigneeMailingName: "Site Office", consigneeAddressType: "Site", consigneeAddress: "3 Lane", consigneeState: "Karnataka", consigneeCountry: "India", consigneeGstin: "29ABCDE1234F1Z5", consigneePincode: "560002" };
    const gst = { gstRateDetails: "Specify Details Here", gstTaxability: "Taxable", igstRate: "18", cgstRate: "9", sgstRate: "9", hsnDetails: "Specify Details Here", hsn: "85015210", hsnDescription: "Electric motors" };
    const { batch, documents } = await run(rows(head("SO/900", "Beta Corp", "1180", consignee), item("GM-2HP", "1", "1000", "1000", gst), ledger("Output IGST 18%", "180")));
    expect([batch?.status, documents]).toEqual(["completed", 1]);
    const [d] = await order("SO/900");
    const details = (await pg.query<{ details: { consignee: Record<string, unknown>; ledgers: { name: string; rate: number }[] } }>(`select details from tally_documents where id = $1`, [d!.id])).rows[0]!.details;
    expect(details.consignee).toEqual({ sameAsBuyer: false, billTo: "Site Office", mailingName: "Site Office", addressType: "Site", address: "3 Lane", state: "Karnataka", country: "India", gstin: "29ABCDE1234F1Z5", pincode: "560002" });
    expect(d!.lines[0]).toMatchObject({ gst: { rateDetails: "Specify Details Here", igstRate: 18, cgstRate: 9, sgstRate: 9, taxablePaise: 100000 }, hsn: { code: "85015210", description: "Electric motors" } });
  });

  it("13 · with a Tally Ledgers list, a ledger it doesn't list holds the order back until matched by hand; the match is used and stored", async () => {
    await pg.query(`insert into lookup_items (list_key, label) values ('tally_ledger', 'Sales'), ('tally_ledger', 'IGST Output @18')`);
    try {
      const data = rows(head("SO/910", "Beta Corp", "1180"), item("GM-2HP", "1", "1000", "1000"), ledger("Output IGST 18%", "180"));
      const checked = await check(data);
      expect(checked.ok && checked.rows.map((r) => r.state)).toEqual(["invalid", "invalid", "invalid"]);
      expect(checked.ok && checked.rows[2]!.messages[0]).toMatch(/Ledger "Output IGST 18%" isn't in the Sales Orders — Tally Ledgers list/);
      expect(checked.ok && checked.matches!.ledgers.map((l) => [l.name, l.status])).toEqual([["Sales", "matched"], ["Output IGST 18%", "unmatched"]]);
      expect((await queries.salesOrderLinkOptions()).ledgers.map((l) => l.value)).toEqual(["IGST Output @18", "Sales"]);
      const refused = await run(data);
      expect(await order("SO/910")).toHaveLength(0);
      expect(refused.batch?.rejectedRows).toBe(3);

      const links = { customers: {}, products: {}, ledgers: { outputigst18: "IGST Output @18" } };
      const done = await run(data, { links });
      expect(done.documents).toBe(1);
      const [d] = await order("SO/910");
      const ledgers = (await pg.query<{ l: { name: string; listedAs?: string | null }[] }>(`select details->'ledgers' as l from tally_documents where id = $1`, [d!.id])).rows[0]!.l;
      expect(ledgers.map((l) => [l.name, l.listedAs ?? null])).toEqual([["Beta Corp", null], ["Sales", "Sales"], ["Output IGST 18%", "IGST Output @18"]]);
      expect((await audit(done.batch!.id))[0]!.reason).toMatch(/Ledger "Output IGST 18%" was matched by hand to "IGST Output @18"/);
    } finally {
      await pg.query(`delete from lookup_items where list_key = 'tally_ledger'`);
    }
  });

  it("an order entered on the form imports exactly like a file, with the customer and items the person chose", async () => {
    const o = emptySalesOrder();
    Object.assign(o.voucher, { ...soVoucher("Alpha Traders"), documentDate: "2026-04-02", documentNo: "SO/FORM-1", orderDate: "2026-04-02" });
    o.customerId = id.alpha!;
    o.customerName = "Alpha Traders";
    o.party = { rate: "0", narration: "Customer", description: "Customer ledger", costCentres: [] };
    o.sales = { name: "Sales", rate: "0", narration: "Sales", description: "Sales ledger", costCentres: [] };
    o.items = [{ productRef: `sku:${id.sku1}`, itemName: "Gear Motor 1HP B3", values: { itemDescription: "Motor", quantity: "2", rate: "1500", ratePer: "Nos", gstRateDetails: "As per Masters/Company", reverseCharge: "No", itcEligible: "No", taxableValue: "3000.00", hsnDetails: "As per Masters/Company" }, allocations: [{ dueDate: "2026-04-20" }] }];
    const built = salesOrderFormRows(o);
    const { batch, documents } = await run(built.rows, { links: salesOrderFormLinks(o), fileName: "Entered on the form — SO/FORM-1" });
    expect([batch?.status, documents, batch?.fileName]).toEqual(["completed", 1, "Entered on the form — SO/FORM-1"]);
    const [d] = await order("SO/FORM-1");
    expect(d).toMatchObject({ customer_master_id: id.alpha, party_name: "Alpha Traders", reference_no: "PO-1" });
    expect(Number(d!.total_paise)).toBe(300000);
    expect(d!.lines[0]).toMatchObject({ item: "Gear Motor 1HP B3", skuId: id.sku1, quantity: 2, amountPaise: 300000, dueDate: "2026-04-20" });
    // A retry of the same entry adds nothing.
    const again = await run(built.rows, { links: salesOrderFormLinks(o) });
    expect(again.documents).toBe(0);
    expect(await order("SO/FORM-1")).toHaveLength(1);
  });

  it("the form's customer lookup needs the import permission and only reads the Customer Master", async () => {
    await pg.query(`update customer_masters set state = 'Maharashtra', country = 'India', gst_registration_type = 'Regular', billing_address = '1 Test Road' where id = $1`, [id.alpha]);
    expect(await actions.getSalesOrderCustomer(id.alpha)).toEqual({ name: "Alpha Traders", gstin: "27ABCDE1234F1Z5", state: "Maharashtra", country: "India", registrationType: "Regular", address: "1 Test Road", pincode: null });
    expect(await actions.getSalesOrderCustomer("not-a-uuid")).toBeNull();
    const plain = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('noperm', 'noperm@example.test', 'both', true) returning id`)).rows[0]!.id;
    h.me = { id: plain, email: "noperm@example.test", name: "noperm", isActive: true, isAdmin: true, departmentId: null };
    await expect(actions.getSalesOrderCustomer(id.alpha)).rejects.toThrow();
  });

  it("without database update 0127 nothing can be imported (no field is ever dropped), and an order page still opens", async () => {
    await pg.exec(`alter table tally_documents drop column details`);
    try {
      expect(await queries.salesOrderDetailsReady()).toBe(false);
      const refused = await actions.startTallyImport({ fieldConfigVersion: await fcv(), category: "sales-orders", fileName: "x.xlsx", fileHash: hash(), sheetName: null, headers: H, sample: [], mapping: M, totalRows: 1, asOfDate: null, direction: null, includeAttention: false, confirm: true });
      expect(refused).toEqual({ ok: false, error: expect.stringMatching(/database update 0127/) });
      const ledgerQ = await import("@/lib/queries/tally-ledger");
      const [d] = await order("SO/900");
      const page = await ledgerQ.getDocument({} as never, "sales-orders", d!.id as string);
      expect(page?.document).toMatchObject({ documentNo: "SO/900", details: {} });
    } finally {
      await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0127_sales_order_details.sql"), "utf8"));
    }
    expect(await queries.salesOrderDetailsReady()).toBe(true);
  });
});

describe("exact duplicates versus changed versions, through the real actions", () => {
  it("re-importing the same order skips it; a corrected version is refused with its changes named, and the stored order stays exactly as it was", async () => {
    const data = (over: SoCells = {}) => rows(head("SO/930", "Beta Corp", "1000", over), item("GM-2HP", "1", "1000", "1000"));
    const first = await run(data());
    expect(first.documents).toBe(1);
    const [stored] = await order("SO/930");
    const before = (await pg.query<{ d: unknown; l: unknown }>(`select details as d, lines as l from tally_documents where id = $1`, [stored!.id])).rows[0];

    const same = await run(data());
    expect(same.documents).toBe(0);
    expect((await audit(same.batch!.id)).map((r) => [r.status, r.reason])).toEqual([["skipped", "Already in Sales Orders; skipped."], ["skipped", "Already in Sales Orders; skipped."]]);

    const corrected = data({ carrier: "Another Transport", buyerAddress: "9 New Road" });
    const checked = await check(corrected);
    expect(checked.ok && checked.rows[0]!.messages[0]).toMatch(/already in Sales Orders with different order details: .*Carrier Name\/Agent \("Test Transport" → "Another Transport"\)/);
    expect(checked.ok && checked.rows[0]!.messages[0]).toContain(`Buyer/Supplier - Address ("1 Test Road" → "9 New Road")`);
    const refused = await run(corrected);
    expect(refused.documents).toBe(0);
    expect((await audit(refused.batch!.id))[0]).toMatchObject({ status: "rejected", reason: expect.stringMatching(/never overwritten/) });
    expect((await pg.query<{ d: unknown; l: unknown }>(`select details as d, lines as l from tally_documents where id = $1`, [stored!.id])).rows[0]).toEqual(before);
    expect(await order("SO/930")).toHaveLength(1);
  });
});
