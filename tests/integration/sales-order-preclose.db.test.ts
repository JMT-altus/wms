import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// REAL-POSTGRES tests (in-memory PGlite, running migrations 0122, 0127, 0128 and 0129's own SQL) for the Read Me's
// "Update" fields — pre-closing a delivery of a stored Sales Order — and for the x fields the WMS now offers, imported
// into a real order. Invented data only; only the session (and which addresses count as super-admins) is mocked.
// Nothing here reaches a real database.
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
import { importFields, type SoCatalogue } from "@/lib/tally/sales-order-config";
import { templateHeadings, templateRow } from "@/lib/tally/sales-order-template";
import { soEntry, soLine, soVoucher } from "../fixtures/sales-order-rows";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let importActions: typeof import("@/app/(forms-module)/forms/tally-import/actions");
let preclose: typeof import("@/app/(forms-module)/forms/documents/[type]/[id]/actions");
let preQ: typeof import("@/lib/queries/sales-order-preclosures");
let fieldsQ: typeof import("@/lib/queries/sales-order-fields");
let fieldActions: typeof import("@/app/(masters)/master-setup/sales-order-fields/actions");
const who: Record<"root" | "admin" | "staff" | "outsider", string> = { root: "", admin: "", staff: "", outsider: "" };
const TODAY = "2026-10-31";
let seq = 0;
const hash = () => String(++seq).padStart(64, "0");
const signIn = (k: keyof typeof who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: `${k} user`, isActive: true, isAdmin: k === "root" || k === "admin", departmentId: null };
};
const migration = (m: string) => readFileSync(resolve(__dirname, "../../db/migrations", m), "utf8");

/** One order in the configuration's template layout: one item of 2 Nos split over two deliveries (1.5 and 0.5), with x fields the WMS offers. */
function orderRows(c: SoCatalogue, no: string): RawRow[] {
  const head = templateRow(c, { documentDate: "01-04-2026", documentNo: no, partyName: "Alpha Traders", amount: "2000", drCr: "Dr", ...soVoucher("Alpha Traders"), ...soEntry, orderDate: "01-04-2026", voucherRefNo: "REF-9", effectiveDate: "02-04-2026", portOfLoading: "Nhava Sheva", buyerOtherTerritory: "no" });
  const item = templateRow(c, { partyName: "Sales", amount: "2000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "2", rate: "1000", lineAmount: "2000", ...soLine("2000", "15-04-2026"), marks: "M-1", actualQuantity: "2", allocQuantity: "1.5", allocRate: "1000", allocRatePer: "Nos", allocAmount: "1500", allocActualQuantity: "1.5" });
  const second = templateRow(c, { allocQuantity: "0.5", allocRate: "1000", allocRatePer: "Nos", allocAmount: "500", dueDate: "30-04-2026", allocUom: "Nos" });
  return [head, item, second].map((cells, i) => ({ rowNo: i + 2, cells }));
}

async function importOrder(no: string) {
  const { catalogue: c } = await fieldsQ.loadSalesOrderCatalogue();
  const data = orderRows(c, no);
  const mapping = Object.fromEntries(importFields(c).map((f, i) => [f.key, i]));
  const started = await importActions.startTallyImport({ fieldConfigVersion: c.version, category: "sales-orders", fileName: "orders.xlsx", fileHash: hash(), sheetName: "Accounting Voucher", headers: templateHeadings(c), sample: data, mapping, totalRows: data.length, asOfDate: null, direction: null, includeAttention: false, confirm: true });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const plan = planRows("sales-orders", data, mapping, { asOfDate: null, direction: null, today: TODAY, soCatalogue: c });
  for (const part of chunkRows(data, plan.rows)) await importActions.importTallyChunk({ fieldConfigVersion: c.version, batchId: started.batchId, rows: part });
  const finished = await importActions.finishTallyImport(started.batchId);
  expect(finished).toMatchObject({ ok: true, documents: 1 });
  return (await pg.query<{ id: string }>(`select id from tally_documents where document_no = $1`, [no])).rows[0]!.id;
}
const stored = async (id: string) => (await pg.query<{ lines: unknown; details: unknown }>(`select lines, details from tally_documents where id = $1`, [id])).rows[0]!;
const send = (documentId: string, over: Record<string, unknown> = {}) =>
  preclose.preCloseDelivery({ documentId, requestId: randomUUID(), lineNo: 1, allocationNo: 1, quantity: "0.5", reason: "Customer reduced the order", date: "2026-04-10", expectedCount: 0, ...over });

let orderId = "";

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
  // 0129 is applied later: the first tests run without it.
  for (const m of ["0122_tally_import.sql", "0127_sales_order_details.sql", "0128_sales_order_field_settings.sql"]) await pg.exec(migration(m));
  const one = async (sql: string, params: unknown[] = []) => (await pg.query<{ id: string }>(sql, params)).rows[0]!.id;
  for (const k of Object.keys(who) as (keyof typeof who)[]) who[k] = await one(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [`${k} user`, `${k}@example.test`, k === "root" || k === "admin"]);
  // The importer; and two employees given the pre-close permission — only one of them can see the Forms module.
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [who.root]);
  for (const k of ["staff", "outsider"] as const) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('sales-orders.preclose', 'employee', $1, true)`, [who[k]]);
  await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('forms', 'employee', $1, true)`, [who.staff]);
  await one(`insert into customer_masters (name, code, gstin) values ('Alpha Traders', '00001', '27ABCDE1234F1Z5') returning id`);
  const motor = await one(`insert into products (name, code) values ('Gear Motor', 'GM') returning id`);
  await one(`insert into product_skus (product_id, sku_code, variant_label, uom) values ($1, 'GM-1', '1 HP', 'Nos') returning id`, [motor]);
  importActions = await import("@/app/(forms-module)/forms/tally-import/actions");
  preclose = await import("@/app/(forms-module)/forms/documents/[type]/[id]/actions");
  preQ = await import("@/lib/queries/sales-order-preclosures");
  fieldsQ = await import("@/lib/queries/sales-order-fields");
  fieldActions = await import("@/app/(masters)/master-setup/sales-order-fields/actions");
  signIn("root");
  orderId = await importOrder("SO/PC/1");
}, 120_000);
afterAll(async () => {
  await pg.close();
});
beforeEach(() => signIn("root"));

describe("the x fields the WMS offers, imported into a real order", () => {
  it("are stored by key with their order, line and delivery, as stored values (dates yyyy-mm-dd, Yes/No)", async () => {
    const s = (await stored(orderId)) as { details: { custom?: Record<string, string> }; lines: { custom?: Record<string, string>; allocations: { custom?: Record<string, string> }[] }[] };
    expect(s.details.custom).toEqual({ voucherRefNo: "REF-9", effectiveDate: "2026-04-02", portOfLoading: "Nhava Sheva", buyerOtherTerritory: "No" });
    expect(s.lines[0]!.custom).toEqual({ marks: "M-1", actualQuantity: "2" });
    expect(s.lines[0]!.allocations.map((a) => a.custom ?? null)).toEqual([{ allocActualQuantity: "1.5" }, { allocUom: "Nos" }]);
  });
});

describe("without migration 0129", () => {
  it("the order page says pre-closing isn't available, and recording one writes nothing", async () => {
    expect(await preQ.listPreClosures(orderId)).toEqual({ ready: false, records: [] });
    expect(await send(orderId)).toEqual({ ok: false, error: preQ.PRECLOSE_NOT_READY });
    // The migration itself, applied twice (it is safe to re-run).
    await pg.exec(migration("0129_sales_order_preclosures.sql"));
    await pg.exec(migration("0129_sales_order_preclosures.sql"));
    expect(await preQ.listPreClosures(orderId)).toEqual({ ready: true, records: [] });
  });
});

describe("who may pre-close", () => {
  it("a super-admin, or someone granted sales-orders.preclose who can see the Forms module; nobody else", async () => {
    signIn("admin"); // an admin without the grant
    await expect(send(orderId)).rejects.toThrow("Forbidden");
    signIn("outsider"); // the grant, but no Forms module
    await expect(send(orderId)).rejects.toThrow("Forbidden");
    expect((await preQ.listPreClosures(orderId)).records).toEqual([]); // nothing was written
    const { PERMISSION_FIELDS } = await import("@/db/enums");
    expect(PERMISSION_FIELDS.find((f) => f.key === "sales-orders.preclose")).toMatchObject({ defaultAllowed: false, sensitive: true, adminBypass: false });
  });
});

describe("recording a pre-closure", () => {
  it("records quantity, reason and date with who and when; the stored order is never changed", async () => {
    const before = await stored(orderId);
    signIn("staff");
    const res = await send(orderId, { quantity: "0.5", reason: "  Customer   reduced the order ", date: "10-04-2026" });
    expect(res).toMatchObject({ ok: true, repeated: false, record: { lineNo: 1, allocationNo: 1, quantity: 0.5, reason: "Customer reduced the order", precloseDate: "2026-04-10", recordedBy: "staff user" } });
    const row = (await pg.query(`select item, due_date::text, ordered_quantity::text, recorded_by_id from sales_order_preclosures`)).rows[0];
    expect(row).toMatchObject({ item: "Gear Motor", due_date: "2026-04-15", ordered_quantity: "1.500000", recorded_by_id: who.staff });
    expect(await stored(orderId)).toEqual(before);
  });

  it("the same submission sent twice is recorded once", async () => {
    const requestId = randomUUID();
    const a = await send(orderId, { requestId, quantity: "0.25", expectedCount: 1 });
    const b = await send(orderId, { requestId, quantity: "0.25", expectedCount: 1 });
    expect(a).toMatchObject({ ok: true, repeated: false });
    expect(b).toMatchObject({ ok: true, repeated: true });
    if (a.ok && b.ok) expect(b.record.id).toBe(a.record.id);
    expect((await preQ.listPreClosures(orderId)).records).toHaveLength(2);
    // …and a request id can't be reused for another delivery.
    expect(await send(orderId, { requestId, allocationNo: 2 })).toEqual({ ok: false, error: expect.stringMatching(/already used for another delivery/) });
  });

  it("a screen that didn't see the latest pre-closure is refused, never adding a second one by accident", async () => {
    expect(await send(orderId, { quantity: "0.25", expectedCount: 1 })).toEqual({ ok: false, error: expect.stringMatching(/pre-closed by someone else meanwhile/) });
    expect((await preQ.listPreClosures(orderId)).records).toHaveLength(2);
  });

  it("checks the quantity against what is open, the date against the order and today, and the reason", async () => {
    // Delivery 1.1: 1.5 ordered, 0.75 pre-closed, 0.75 open.
    const e = async (over: Record<string, unknown>) => {
      const r = await send(orderId, { expectedCount: 2, ...over });
      return r.ok ? "" : r.error;
    };
    expect(await e({ quantity: "0.76" })).toMatch(/more than the delivery's open quantity, 0.75 Nos/);
    expect(await e({ quantity: "0" })).toMatch(/must be more than zero/);
    expect(await e({ quantity: "abc" })).toMatch(/isn't a number/);
    expect(await e({ date: "2026-03-31" })).toMatch(/before the order's Voucher Date 2026-04-01/);
    expect(await e({ date: "2099-01-01" })).toMatch(/after today/);
    expect(await e({ reason: "   " })).toMatch(/Reason for Pre-Close is required/);
    expect(await e({ reason: "x".repeat(501) })).toMatch(/longer than 500/);
    expect(await e({ allocationNo: 3 })).toMatch(/isn't in this order/);
    expect((await preQ.listPreClosures(orderId)).records).toHaveLength(2);
    // What is left can be pre-closed exactly; then the delivery is closed.
    expect(await send(orderId, { quantity: "0.75", expectedCount: 2 })).toMatchObject({ ok: true });
    expect(await e({ quantity: "0.1", expectedCount: 3 })).toMatch(/already fully pre-closed/);
  });

  it("the reason follows the configuration: made optional in Sales Order Fields, it may be left blank", async () => {
    const saved = await fieldActions.saveSalesOrderField({ fieldKey: "preCloseReason", isCustom: false, scope: "allocation", label: "Why", section: null, displayOrder: null, requirement: "optional", condition: null, fieldType: null, options: null, inForm: true, inImport: false, onOrderPage: true, status: "active", expectedRowVersion: 0 });
    expect(saved).toMatchObject({ ok: true });
    // The quantity and date are locked: their requirement can't change.
    expect(await fieldActions.saveSalesOrderField({ fieldKey: "preCloseQuantity", isCustom: false, scope: "allocation", label: null, section: null, displayOrder: null, requirement: "optional", condition: null, fieldType: null, options: null, inForm: true, inImport: false, onOrderPage: true, status: "active", expectedRowVersion: 0 })).toMatchObject({ ok: false });
    const r = await send(orderId, { allocationNo: 2, quantity: "0.5", reason: "", date: "2026-04-20", expectedCount: 0 });
    expect(r).toMatchObject({ ok: true, record: { reason: null } });
  });
});

describe("the database itself (migration 0129)", () => {
  const insert = (over: Record<string, unknown> = {}) => {
    const v = { document_id: orderId, line_no: 1, allocation_no: 2, item: "Gear Motor", due_date: "2026-04-30", ordered_quantity: "0.5", quantity: "0.1", reason: "Direct", preclose_date: "2026-04-20", request_id: randomUUID(), recorded_by_id: who.root, recorded_by_name: "root user", ...over };
    const cols = Object.keys(v);
    return pg.query(`insert into sales_order_preclosures (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(v));
  };

  it("refuses a pre-closure beyond the delivery, one that doesn't match the stored delivery, or one before the order", async () => {
    await expect(insert()).rejects.toThrow(/open quantity/); // delivery 1.2 is already fully pre-closed
    const other = await importOrder("SO/PC/2");
    await expect(insert({ document_id: other, quantity: "0.6" })).rejects.toThrow(); // more than its 0.5
    await expect(insert({ document_id: other, ordered_quantity: "5", quantity: "1" })).rejects.toThrow(/does not match the stored delivery/);
    await expect(insert({ document_id: other, item: "Something else" })).rejects.toThrow(/does not match/);
    await expect(insert({ document_id: other, allocation_no: 9 })).rejects.toThrow(/not in the order/);
    await expect(insert({ document_id: other, preclose_date: "2026-03-01" })).rejects.toThrow(/before the order's Voucher Date/);
    await expect(insert({ document_id: other })).resolves.toBeTruthy();
    // A second row with a used request id is refused by its unique key.
    const used = (await pg.query<{ r: string }>(`select request_id::text as r from sales_order_preclosures limit 1`)).rows[0]!.r;
    await expect(insert({ document_id: other, request_id: used })).rejects.toThrow();
  });

  it("is append-only: no pre-closure can be changed or removed; deleting its employee only clears the link", async () => {
    await expect(pg.query(`update sales_order_preclosures set quantity = 0.01`)).rejects.toThrow(/append-only/);
    await expect(pg.query(`update sales_order_preclosures set reason = 'edited'`)).rejects.toThrow(/append-only/);
    await expect(pg.query(`delete from sales_order_preclosures`)).rejects.toThrow(/append-only/);
    const n = Number((await pg.query<{ n: string }>(`select count(*)::text as n from sales_order_preclosures`)).rows[0]!.n);
    const gone = await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('Temp', 'temp@example.test', 'both', false) returning id`);
    const temp = gone.rows[0]!.id;
    await pg.query(`insert into sales_order_preclosures (document_id, line_no, allocation_no, item, due_date, ordered_quantity, quantity, reason, preclose_date, request_id, recorded_by_id, recorded_by_name) select id, 1, 1, 'Gear Motor', '2026-04-15', 1.5, 0.1, 'by temp', '2026-04-20', gen_random_uuid(), $1, 'Temp' from tally_documents where document_no = 'SO/PC/2'`, [temp]);
    await pg.query(`delete from employees where id = $1`, [temp]);
    const kept = (await pg.query<{ id: string | null; name: string }>(`select recorded_by_id as id, recorded_by_name as name from sales_order_preclosures where reason = 'by temp'`)).rows[0]!;
    expect(kept).toEqual({ id: null, name: "Temp" });
    expect(Number((await pg.query<{ n: string }>(`select count(*)::text as n from sales_order_preclosures`)).rows[0]!.n)).toBe(n + 1);
  });

  it("is closed to the REST roles: row-level security is on", async () => {
    const r = await pg.query<{ on: boolean }>(`select relrowsecurity as on from pg_class where relname = 'sales_order_preclosures'`);
    expect(r.rows[0]!.on).toBe(true);
  });
});

describe("the order's history", () => {
  it("lists every pre-closure, oldest first, with who recorded it", async () => {
    const { records } = await preQ.listPreClosures(orderId);
    expect(records.map((r) => [r.lineNo, r.allocationNo, r.quantity, r.recordedBy])).toEqual([
      [1, 1, 0.5, "staff user"],
      [1, 1, 0.25, "root user"],
      [1, 1, 0.75, "root user"],
      [1, 2, 0.5, "root user"],
    ]);
  });
});
