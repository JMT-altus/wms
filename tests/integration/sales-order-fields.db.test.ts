import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite, running migrations 0122, 0127 and 0128's own SQL) for Admin & Master Setup →
// Sales Order Fields: who may change the configuration, its versions and history, concurrent changes, locked fields,
// custom fields at every scope, retiring and restoring, and imports under a configuration that changes. Invented data
// only; only the session (and which addresses count as super-admins) is mocked. Nothing here reaches a real database.
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
// An invented super-admin address: the real list is never used by these tests.
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
import { buildCatalogue, importFields, type FieldScope, type SoCatalogue } from "@/lib/tally/sales-order-config";
import { templateHeadings, templateRow } from "@/lib/tally/sales-order-template";
import { soEntry, soLine, soVoucher, type SoCells } from "../fixtures/sales-order-rows";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let fieldActions: typeof import("@/app/(masters)/master-setup/sales-order-fields/actions");
let importActions: typeof import("@/app/(forms-module)/forms/tally-import/actions");
let fieldsQ: typeof import("@/lib/queries/sales-order-fields");
const who: Record<"root" | "manager" | "admin" | "staff", string> = { root: "", manager: "", admin: "", staff: "" };
const TODAY = "2026-10-31";
let seq = 0;
const hash = () => String(++seq).padStart(64, "0");

const signIn = (k: keyof typeof who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: k !== "staff", departmentId: null };
};
/** A complete setting as the screen sends it; `over` is what the test is about. */
const input = (over: Record<string, unknown>) => ({
  fieldKey: null, isCustom: false, scope: "voucher", label: null, section: null, displayOrder: null, requirement: null, condition: null, fieldType: null, options: null,
  inForm: true, inImport: true, onOrderPage: true, status: "active", expectedRowVersion: 0, ...over,
});
const customInput = (label: string, scope: FieldScope, over: Record<string, unknown> = {}) => input({ isCustom: true, scope, label, section: "Extra", fieldType: "text", requirement: "optional", ...over });
const save = (over: Record<string, unknown>) => fieldActions.saveSalesOrderField(input(over));
const current = async () => (await fieldsQ.loadSalesOrderCatalogue()).catalogue;
const rowVersion = async (key: string) => (await pg.query<{ v: number }>(`select row_version as v from sales_order_field_settings where field_key = $1`, [key])).rows[0]?.v ?? 0;
const history = async (key: string) => (await pg.query<{ version: string; action: string; before: unknown; after: Record<string, unknown> }>(`select version::text, action, before, after from sales_order_field_history where field_key = $1 order by version`, [key])).rows;

/** An order in the configuration's own template layout. */
function orderRows(c: SoCatalogue, no: string, over: { head?: SoCells; item?: SoCells } = {}): RawRow[] {
  const head = templateRow(c, { documentDate: "01-04-2026", documentNo: no, partyName: "Alpha Traders", amount: "1000", drCr: "Dr", ...soVoucher("Alpha Traders"), ...soEntry, orderDate: "01-04-2026", ...over.head });
  const item = templateRow(c, { partyName: "Sales", amount: "1000", drCr: "Cr", ...soEntry, itemName: "Gear Motor", quantity: "1", rate: "1000", lineAmount: "1000", ...soLine("1000"), ...over.item });
  return [head, item].map((cells, i) => ({ rowNo: i + 2, cells }));
}
const mappingOf = (c: SoCatalogue) => Object.fromEntries(importFields(c).map((f, i) => [f.key, i]));

/** The browser's import flow, sending the configuration version it validated with. */
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
const storedDetails = async (no: string) => (await pg.query<{ details: Record<string, unknown> & { custom?: Record<string, unknown>; ledgers: { custom?: Record<string, unknown> }[]; additionalCosts: unknown[] }; lines: { custom?: Record<string, unknown>; allocations?: { custom?: Record<string, unknown> }[] }[] }>(`select details, lines from tally_documents where document_type = 'sales-orders' and document_no = $1`, [no])).rows[0];

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
  for (const m of ["0122_tally_import.sql", "0127_sales_order_details.sql", "0128_sales_order_field_settings.sql"]) await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations", m), "utf8"));
  const one = async (sql: string, params: unknown[] = []) => (await pg.query<{ id: string }>(sql, params)).rows[0]!.id;
  for (const k of Object.keys(who) as (keyof typeof who)[]) who[k] = await one(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k}@example.test`, k !== "staff"]);
  // The manager is an ordinary admin given the permission explicitly; everyone may import.
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

describe("who may change the configuration", () => {
  it("a super-admin and an admin granted sales-orders.fields.manage may; an ordinary admin and a non-admin may not", async () => {
    signIn("admin");
    await expect(save({ fieldKey: "carrier", label: "Transporter" })).rejects.toThrow("Forbidden");
    signIn("staff");
    await expect(save({ fieldKey: "carrier", label: "Transporter" })).rejects.toThrow("Forbidden");
    expect(await rowVersion("carrier")).toBe(0); // nothing was written

    signIn("manager");
    expect(await save({ fieldKey: "carrier", label: "Transporter" })).toMatchObject({ ok: true, fieldKey: "carrier" });
    signIn("root");
    expect(await save({ fieldKey: "carrier", label: "Carrier", expectedRowVersion: 1 })).toMatchObject({ ok: true });
  });

  it("the permission is not on by default and admin status doesn't imply it", async () => {
    const { PERMISSION_FIELDS } = await import("@/db/enums");
    const p = PERMISSION_FIELDS.find((f) => f.key === "sales-orders.fields.manage")!;
    expect(p).toMatchObject({ defaultAllowed: false });
    expect((p as { adminBypass?: boolean }).adminBypass ?? false).toBe(false);
  });
});

describe("versions, history and concurrent changes", () => {
  it("every saved change is one new configuration version, with who, before and after", async () => {
    const v0 = (await current()).version;
    const a = await save({ fieldKey: "priceLevel", requirement: "mandatory" });
    const b = await save({ fieldKey: "priceLevel", requirement: "optional", expectedRowVersion: 1 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.version).toBeGreaterThan(v0);
    expect(b.version).toBe(a.version + 1);
    expect((await current()).version).toBe(b.version);
    const rows = await history("priceLevel");
    expect(rows.map((r) => r.action)).toEqual(["create", "update"]);
    expect(rows[0]!.before).toBeNull();
    expect(rows[1]!.before).toMatchObject({ requirement: "mandatory", rowVersion: 1 });
    expect(rows[1]!.after).toMatchObject({ requirement: "optional", fieldKey: "priceLevel" });
    const listed = await fieldsQ.listFieldHistory(10);
    expect(listed.rows.find((r) => r.version === b.version)).toMatchObject({ fieldKey: "priceLevel", action: "update", changedBy: "root" });
  });

  it("a change made by someone else meanwhile is never overwritten", async () => {
    expect(await save({ fieldKey: "destination", label: "Ship to city" })).toMatchObject({ ok: true });
    const before = (await current()).version;
    // Two screens read row version 1; the first saves, the second is refused.
    expect(await save({ fieldKey: "destination", label: "City", expectedRowVersion: 1 })).toMatchObject({ ok: true });
    const stale = await save({ fieldKey: "destination", label: "Town", expectedRowVersion: 1 });
    expect(stale).toEqual({ ok: false, error: expect.stringMatching(/changed by someone else meanwhile/) });
    expect((await current()).byKey.get("destination")!.label).toBe("City");
    expect((await current()).version).toBe(before + 1);
    // A screen that thinks a field has no setting yet, when it now has one, is refused too.
    expect(await save({ fieldKey: "destination", label: "Town", expectedRowVersion: 0 })).toMatchObject({ ok: false });
  });

  it("concurrent saves are serialised: exactly one of two racing changes to the same field wins", async () => {
    const [x, y] = await Promise.all([save({ fieldKey: "deliveryTerms", label: "Delivery terms A" }), save({ fieldKey: "deliveryTerms", label: "Delivery terms B" })]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(await rowVersion("deliveryTerms")).toBe(1);
  });

  it("settings are never deleted and history is append-only (the database refuses both)", async () => {
    await expect(pg.query(`delete from sales_order_field_settings where field_key = 'carrier'`)).rejects.toThrow();
    await expect(pg.query(`update sales_order_field_history set action = 'update' where field_key = 'carrier'`)).rejects.toThrow();
    await expect(pg.query(`delete from sales_order_field_history where field_key = 'carrier'`)).rejects.toThrow();
  });
});

describe("locked fields and the safe condition vocabulary", () => {
  it("a locked field's label and display order can change; its requirement, availability and status cannot", async () => {
    expect(await save({ fieldKey: "documentNo", label: "Order number", displayOrder: 5 })).toMatchObject({ ok: true });
    expect((await current()).byKey.get("documentNo")).toMatchObject({ label: "Order number", displayOrder: 5, locked: true });
    for (const over of [{ requirement: "optional" }, { status: "retired" }, { inImport: false }, { inForm: false }, { onOrderPage: false }]) {
      const res = await save({ fieldKey: "documentNo", label: "Order number", expectedRowVersion: 1, ...over });
      expect(res).toEqual({ ok: false, error: expect.stringMatching(/Voucher Number is locked/) });
    }
    for (const key of ["documentDate", "voucherType", "partyName", "amount", "itemName", "quantity", "rate", "lineAmount"]) {
      const scope = ["partyName", "amount"].includes(key) ? "ledger" : ["itemName", "quantity", "rate", "lineAmount"].includes(key) ? "item" : "voucher";
      expect(await save({ fieldKey: key, scope, status: "retired" })).toMatchObject({ ok: false });
    }
  });

  it("a locked field keeps its approved conditional rule (it isn't made unconditionally mandatory)", async () => {
    const c = await current();
    for (const key of ["documentNo", "documentDate", "voucherType", "partyName", "amount", "itemName", "quantity", "rate", "lineAmount"]) {
      const f = c.byKey.get(key)!;
      expect(f.locked).toBe(true);
      expect(f.requirementRule).toEqual(buildCatalogue([]).byKey.get(key)!.requirementRule);
    }
  });

  it("only the fixed condition vocabulary is accepted; anything else is refused before it is looked at", async () => {
    for (const condition of [{ op: "eval", code: "process.exit()" }, { op: "in", field: "buyerRegType", values: "Regular" }, "buyerRegType == 'Regular'", { op: "ledgerKind", values: ["everyone"] }]) {
      const res = await save({ fieldKey: "otherReferences", requirement: "conditional", condition });
      expect(res.ok).toBe(false);
    }
    expect(await save({ fieldKey: "otherReferences", requirement: "conditional", condition: { op: "in", field: "nope", values: ["x"] } })).toEqual({ ok: false, error: expect.stringMatching(/doesn't exist/) });
    expect(await save({ fieldKey: "otherReferences", requirement: "conditional", condition: { op: "in", field: "buyerRegType", values: ["Regular"] } })).toMatchObject({ ok: true });
  });
});

describe("custom fields at every scope", () => {
  const scopes: [FieldScope, string][] = [
    ["voucher", "Project Code"],
    ["ledger", "Cost Head"],
    ["item", "Drawing No"],
    ["allocation", "Batch Ref"],
    ["additionalCost", "Cost Note"],
  ];

  it("are created at each scope with a key of their own, and a label can't be used twice", async () => {
    for (const [scope, label] of scopes) {
      const res = await fieldActions.saveSalesOrderField(customInput(label, scope, scope === "ledger" ? { fieldType: "choice", options: ["Direct", "Indirect"] } : {}));
      expect(res).toMatchObject({ ok: true, fieldKey: `custom_${label.toLowerCase().replace(/ /g, "_")}` });
    }
    expect(await fieldActions.saveSalesOrderField(customInput("project code", "item"))).toEqual({ ok: false, error: expect.stringMatching(/already the name/) });
    expect(await fieldActions.saveSalesOrderField(customInput("Carrier", "voucher"))).toEqual({ ok: false, error: expect.stringMatching(/already the name of the field/) });
    const c = await current();
    for (const [scope, label] of scopes) expect(c.fields.find((f) => f.label === label)).toMatchObject({ scope, isCustom: true, status: "active" });
  });

  it("an order imported under the configuration stores each custom value with its order, ledger, line, allocation and additional cost", async () => {
    signIn("admin");
    const c = await current();
    const data = orderRows(c, "SO/CF/1", { head: { custom_project_code: "Plant 2", custom_cost_head: "indirect" }, item: { custom_drawing_no: "D-7", custom_batch_ref: "B-1" } });
    data.push({ rowNo: 4, cells: templateRow(c, { addlCostLedger: "Freight Inward", addlCostAmount: "50", custom_cost_note: "Road" }) });
    const done = await importOrder(c, data, c.version);
    expect(done.started.ok).toBe(true);
    expect(done.finished).toMatchObject({ ok: true, documents: 1 });
    const stored = (await storedDetails("SO/CF/1"))!;
    expect(stored.details.custom).toEqual({ custom_project_code: "Plant 2" });
    expect(stored.details.ledgers[0]!.custom).toEqual({ custom_cost_head: "Indirect" });
    expect(stored.lines[0]!.custom).toEqual({ custom_drawing_no: "D-7" });
    expect(stored.lines[0]!.allocations![0]!.custom).toEqual({ custom_batch_ref: "B-1" });
    expect(stored.details.additionalCosts).toEqual([expect.objectContaining({ custom: { custom_cost_note: "Road" } })]);
    const batch = (await pg.query<{ v: string | null }>(`select field_config_version::text as v from tally_import_batches where id = $1`, [(done.started as { batchId: string }).batchId])).rows[0]!;
    expect(Number(batch.v)).toBe(c.version); // the batch records the configuration it was imported under
  });

  it("retiring a field keeps every stored value; restoring it brings the field back", async () => {
    const key = "custom_project_code";
    const before = await storedDetails("SO/CF/1");
    const retire = await fieldActions.saveSalesOrderField(customInput("Project Code", "voucher", { fieldKey: key, status: "retired", expectedRowVersion: await rowVersion(key) }));
    expect(retire).toMatchObject({ ok: true });
    expect((await storedDetails("SO/CF/1"))!.details).toEqual(before!.details);
    const c = await current();
    expect(c.byKey.get(key)).toMatchObject({ status: "retired", label: "Project Code" });
    expect(templateHeadings(c)).not.toContain("Project Code");
    const restore = await fieldActions.saveSalesOrderField(customInput("Project Code", "voucher", { fieldKey: key, status: "active", expectedRowVersion: await rowVersion(key) }));
    expect(restore).toMatchObject({ ok: true });
    expect((await history(key)).map((r) => r.action)).toEqual(["create", "retire", "restore"]);
  });

  it("a mandatory custom field is enforced by the import at its own scope", async () => {
    const key = "custom_batch_ref";
    expect(await fieldActions.saveSalesOrderField(customInput("Batch Ref", "allocation", { fieldKey: key, requirement: "mandatory", expectedRowVersion: await rowVersion(key) }))).toMatchObject({ ok: true });
    signIn("admin");
    const c = await current();
    const res = await importActions.checkTallyChunk({ category: "sales-orders", mapping: mappingOf(c), rows: orderRows(c, "SO/CF/2"), asOfDate: null, direction: null, fieldConfigVersion: c.version });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows.flatMap((r) => r.messages).join(" | ")).toMatch(/Batch Ref/);
  });
});

describe("imports and a configuration that changes", () => {
  it("validating with an out-of-date version is refused", async () => {
    signIn("admin");
    const c = await current();
    const res = await importActions.checkTallyChunk({ category: "sales-orders", mapping: mappingOf(c), rows: orderRows(c, "SO/V/1"), asOfDate: null, direction: null, fieldConfigVersion: c.version - 1 });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Sales Order fields were changed/) });
  });

  it("starting an import with an out-of-date version, or none, is refused and nothing is written", async () => {
    signIn("admin");
    const c = await current();
    const batches = (await pg.query<{ n: number }>(`select count(*)::int as n from tally_import_batches`)).rows[0]!.n;
    expect((await importOrder(c, orderRows(c, "SO/V/2", { item: { custom_batch_ref: "B" } }), c.version - 1)).started).toEqual({ ok: false, error: expect.stringMatching(/validate again/) });
    const mapping = mappingOf(c);
    const none = await importActions.startTallyImport({ category: "sales-orders", fileName: "o.xlsx", fileHash: hash(), sheetName: null, headers: templateHeadings(c), sample: [], mapping, totalRows: 2, asOfDate: null, direction: null, includeAttention: false, confirm: true });
    expect(none).toMatchObject({ ok: false });
    expect((await pg.query<{ n: number }>(`select count(*)::int as n from tally_import_batches`)).rows[0]!.n).toBe(batches);
  });

  it("a change saved while an import is running stops its remaining parts: nothing is imported under the old fields", async () => {
    signIn("admin");
    const c = await current();
    const done = await importOrder(c, orderRows(c, "SO/V/3", { item: { custom_batch_ref: "B" } }), c.version, async () => {
      signIn("root");
      expect(await save({ fieldKey: "carrier", label: "Carrier name", expectedRowVersion: await rowVersion("carrier") })).toMatchObject({ ok: true });
      signIn("admin");
    });
    expect(done.started.ok).toBe(true);
    expect(done.chunks).toEqual([{ ok: false, error: expect.stringMatching(/validate again/) }]);
    expect(await storedDetails("SO/V/3")).toBeUndefined();
  });
});

describe("deleting an employee who changed the configuration (0128's one permitted history change)", () => {
  it("succeeds: the history keeps every row and value, and only that employee's reference becomes empty", async () => {
    const leaver = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('leaver', 'leaver@example.test', 'both', true) returning id`)).rows[0]!.id;
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('sales-orders.fields.manage', 'employee', $1, true)`, [leaver]);
    h.me = { id: leaver, email: "leaver@example.test", name: "leaver", isActive: true, isAdmin: true, departmentId: null };
    expect(await save({ fieldKey: "narration", label: "Order narration" })).toMatchObject({ ok: true });
    const snap = async () => (await pg.query<Record<string, unknown>>(`select version, field_key, action, before, after, changed_by_id, changed_at from sales_order_field_history order by version`)).rows;
    const before = await snap();
    expect(before.filter((r) => r.changed_by_id === leaver)).toHaveLength(1);

    await pg.query(`delete from field_permission_grants where subject_id = $1`, [leaver]);
    await pg.query(`delete from employees where id = $1`, [leaver]); // what the admin "Delete employee" action does last

    const after = await snap();
    expect(after).toHaveLength(before.length);
    expect(after.map(({ changed_by_id: _x, ...r }) => r)).toEqual(before.map(({ changed_by_id: _x, ...r }) => r));
    expect(after.map((r) => r.changed_by_id)).toEqual(before.map((r) => (r.changed_by_id === leaver ? null : r.changed_by_id)));
    expect((await pg.query(`select updated_by_id from sales_order_field_settings where field_key = 'narration'`)).rows[0]).toEqual({ updated_by_id: null });
    signIn("root");
    expect((await fieldsQ.listFieldHistory(500)).rows.find((r) => r.fieldKey === "narration")).toMatchObject({ action: "create", changedBy: null });
  });

  it("every other change to the history is still refused, and so is deleting it or a setting", async () => {
    const [row] = (await pg.query<{ version: string }>(`select version::text from sales_order_field_history where changed_by_id is not null order by version limit 1`)).rows;
    for (const q of [
      `update sales_order_field_history set action = 'retire' where version = ${row!.version}`,
      `update sales_order_field_history set changed_by_id = '${who.admin}' where version = ${row!.version}`,
      `update sales_order_field_history set changed_by_id = null, after = '{}' where version = ${row!.version}`,
      `delete from sales_order_field_history where version = ${row!.version}`,
      `delete from sales_order_field_settings where field_key = 'carrier'`,
    ]) await expect(pg.query(q)).rejects.toThrow(/append-only|never deleted/);
  });
});
