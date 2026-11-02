import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// REAL-POSTGRES tests (in-memory PGlite running migration 0122's own SQL) of the Forms sections that show what Tally
// Data Import writes. Records are imported through the REAL server actions; the pages and queries are the real code,
// with the real module-access resolver reading real grant rows. Only "who is signed in" is mocked. Invented data only;
// nothing here can reach a shared database.
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
import type { TallyCategoryKey } from "@/lib/tally/categories";
import { chunkRows, planRows, type RawRow } from "@/lib/tally/plan";
import { TALLY_DOCUMENT_TYPES } from "@/lib/tally/sections";
import { readListParams, type SearchParams } from "@/lib/tally/list-params";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let actions: typeof import("@/app/(forms-module)/forms/tally-import/actions");
let ledger: typeof import("@/lib/queries/tally-ledger");
let access: typeof import("@/lib/auth/forms-access");
let pages: {
  overview: (typeof import("@/app/(forms-module)/forms/page"))["default"];
  customers: (typeof import("@/app/(forms-module)/forms/customer-master/page"))["default"];
  tally: (typeof import("@/app/(forms-module)/forms/tally-import/page"))["default"];
  batch: (typeof import("@/app/(forms-module)/forms/tally-import/batches/[id]/page"))["default"];
  vendors: (typeof import("@/app/(forms-module)/forms/vendor-master/page"))["default"];
  vendor: (typeof import("@/app/(forms-module)/forms/vendor-master/[id]/page"))["default"];
  documents: (typeof import("@/app/(forms-module)/forms/documents/[type]/page"))["default"];
  document: (typeof import("@/app/(forms-module)/forms/documents/[type]/[id]/page"))["default"];
  outstanding: (typeof import("@/app/(forms-module)/forms/outstanding/[view]/page"))["default"];
  line: (typeof import("@/app/(forms-module)/forms/outstanding/[view]/[id]/page"))["default"];
};
let admin: string;
let staff: string;

const sp = (o: SearchParams = {}) => Promise.resolve(o);
const html = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as React.ReactElement);
const signIn = (id: string, isAdmin: boolean) => (h.me = { id, email: `${id}@example.test`, name: isAdmin ? "Admin" : "Staff", isActive: true, isAdmin, departmentId: null });
const asAdmin = () => signIn(admin, true);
const asStaff = () => signIn(staff, false);
const grantForms = (id: string, allowed = true) => pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('forms', 'employee', $1, $2)`, [id, allowed]);
const clearGrants = () => pg.exec("delete from module_access_grants");
/** What a direct URL does: the page's own gate redirects to the hub with ?denied=<module>, or throws Forbidden. */
const outcome = async (p: Promise<unknown>) => {
  try {
    await p;
    return "opens";
  } catch (err) {
    const e = err as { digest?: string; message?: string };
    if (e.digest?.startsWith("NEXT_REDIRECT")) return e.digest.split(";")[2];
    if (e.digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return "not found";
    return e.message;
  }
};
/** The view proof the queries take; the real guard, as a page calls it. */
const viewer = () => access.requireFormsViewer();
const uuidsIn = (s: string) => [...s.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g)].map((m) => m[0]);

const rows = (...r: string[][]): RawRow[] => r.map((cells, i) => ({ rowNo: i + 2, cells }));
const VOUCHER = ["Voucher No.", "Date", "Party", "Amount", "Against"];
const M = { documentNo: 0, documentDate: 1, partyName: 2, amount: 3 };
const MR = { ...M, refDocumentNo: 4 };
let seq = 0;
const hash = () => String(++seq).padStart(64, "0");

async function run(category: TallyCategoryKey, data: RawRow[], mapping: Record<string, number>, over: Record<string, unknown> = {}, headers = VOUCHER) {
  const started = await actions.startTallyImport({ category, fileName: `${category}-${seq + 1}.csv`, fileHash: hash(), sheetName: "S", headers, sample: data.slice(0, 20), mapping, totalRows: data.length, asOfDate: null, direction: null, includeAttention: true, confirm: true, ...over });
  if (!started.ok) throw new Error(`start refused: ${started.error}`);
  const plan = planRows(category, data, mapping, { today: "2026-10-31", asOfDate: (over.asOfDate as string) ?? null, direction: (over.direction as "receivable") ?? null });
  for (const c of chunkRows(data.filter((r) => !started.doneRowNos.includes(r.rowNo)), plan.rows)) {
    const res = await actions.importTallyChunk({ batchId: started.batchId, rows: c });
    if (!res.ok) throw new Error(`chunk refused: ${res.error}`);
  }
  const done = await actions.finishTallyImport(started.batchId);
  if (!done.ok) throw new Error("finish refused");
  return done.batch;
}

const batches: Partial<Record<string, string>> = {};

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec("create sequence if not exists customer_masters_code_seq start 1");
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0122_tally_import.sql"), "utf8"));
  const emp = async (name: string, isAdmin: boolean) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [name, `${name}@example.test`, isAdmin])).rows[0]!.id;
  admin = await emp("admin", true);
  staff = await emp("staff", false);
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [admin]);
  await pg.query(`insert into customer_masters (name, gstin) values ('Alpha Traders', '27ABCDE1234F1Z5'), ('Beta Co', null)`);
  await pg.query(`insert into collection_master_companies (company_name, name_key) values ('Alpha Traders', 'alphatraders')`);
  actions = await import("@/app/(forms-module)/forms/tally-import/actions");
  ledger = await import("@/lib/queries/tally-ledger");
  access = await import("@/lib/auth/forms-access");
  pages = {
    overview: (await import("@/app/(forms-module)/forms/page")).default,
    customers: (await import("@/app/(forms-module)/forms/customer-master/page")).default,
    tally: (await import("@/app/(forms-module)/forms/tally-import/page")).default,
    batch: (await import("@/app/(forms-module)/forms/tally-import/batches/[id]/page")).default,
    vendors: (await import("@/app/(forms-module)/forms/vendor-master/page")).default,
    vendor: (await import("@/app/(forms-module)/forms/vendor-master/[id]/page")).default,
    documents: (await import("@/app/(forms-module)/forms/documents/[type]/page")).default,
    document: (await import("@/app/(forms-module)/forms/documents/[type]/[id]/page")).default,
    outstanding: (await import("@/app/(forms-module)/forms/outstanding/[view]/page")).default,
    line: (await import("@/app/(forms-module)/forms/outstanding/[view]/[id]/page")).default,
  };
}, 180_000);
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await clearGrants();
  asAdmin();
});

describe("before anything is imported", () => {
  it("every section opens for an admin and says honestly that it is empty; the overview counts zero", async () => {
    for (const type of TALLY_DOCUMENT_TYPES) {
      const out = await html(pages.documents({ params: Promise.resolve({ type }), searchParams: sp() }));
      expect(out).toMatch(/No .* yet\./);
      expect(out).toContain("Open Tally Data Import");
      expect(out).toContain("No documents");
    }
    expect(await html(pages.vendors({ searchParams: sp() }))).toContain("No vendors yet.");
    const rec = await html(pages.outstanding({ params: Promise.resolve({ view: "receivables" }), searchParams: sp() }));
    expect(rec).toContain("No receivables snapshot yet.");
    expect(rec).toContain("No completed receivables snapshot has been imported.");
    const overview = await html(pages.overview());
    expect(overview).toContain("0 vendors");
    expect(overview).toContain("0 receivable · 0 payable lines");
    expect(overview).toContain("2 active"); // the two seeded customers
  });

  it("an unknown ledger or view, or an id that isn't one, is not found — not an error", async () => {
    expect(await outcome(pages.documents({ params: Promise.resolve({ type: "sales-register" }), searchParams: sp() }))).toBe("not found");
    expect(await outcome(pages.outstanding({ params: Promise.resolve({ view: "receivable" }), searchParams: sp() }))).toBe("not found");
    expect(await outcome(pages.vendor({ params: Promise.resolve({ id: "nope" }) }))).toBe("not found");
    expect(await outcome(pages.document({ params: Promise.resolve({ type: "sales-orders", id: "00000000-0000-4000-8000-000000000000" }) }))).toBe("not found");
    expect(await outcome(pages.batch({ params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }), searchParams: sp() }))).toBe("not found");
  });
});

describe("importing through the real actions fills the sections", () => {
  it("imports every category once", async () => {
    batches.vendors = (await run("vendor-master", rows(["Vendor One", "27AAAAA0000A1Z5", "Maharashtra"], ["Vendor Two", "", "Gujarat"]), { name: 0, gstin: 1, state: 2 }, {}, ["Name", "GSTIN", "State"])).id;
    batches.so = (await run("sales-orders", rows(["SO/1", "1-Apr-25", "Alpha Traders", "1000"], ["SO/2", "15-May-25", "Beta Co", "2500"], ["SO/3", "10-Apr-24", "Alpha Traders", "500"]), M)).id;
    batches.inv = (await run("sales-invoices", rows(["INV/1", "5-Apr-25", "Alpha Traders", "1000", "SO/1"], ["INV/2", "20-May-25", "Beta Co", "2500", "SO/2"]), MR)).id;
    batches.pi = (await run("purchase-invoices", rows(["PI/1", "2-Apr-25", "Vendor One", "700"]), M)).id;
    batches.cn = (await run("credit-notes", rows(["CN/1", "10-Jun-25", "Alpha Traders", "100", "INV/1"]), MR)).id;
    batches.dn = (await run("debit-notes", rows(["DN/1", "12-Jun-25", "Vendor One", "50", "PI/1"]), MR)).id;
    batches.rc = (await run("customer-receipts", rows(["RC/1", "30-Jun-25", "Alpha Traders", "900", "INV/1"]), MR)).id;
    batches.pay = (await run("vendor-payments", rows(["PAY/1", "1-Jul-25", "Vendor One", "650", "PI/1"]), MR)).id;
    const OUT = ["Party", "Ref", "Date", "Pending"];
    const OM = { partyName: 0, billRef: 1, billDate: 2, pendingAmount: 3 };
    batches.recOld = (await run("outstanding-balances", rows(["Alpha Traders", "INV/1", "5-Apr-25", "100"], ["Beta Co", "INV/2", "20-May-25", "2500"]), OM, { asOfDate: "2026-09-30", direction: "receivable" }, OUT)).id;
    batches.recNew = (await run("outstanding-balances", rows(["Alpha Traders", "INV/1", "5-Apr-25", "100"]), OM, { asOfDate: "2026-10-31", direction: "receivable" }, OUT)).id;
    batches.pay1 = (await run("outstanding-balances", rows(["Vendor One", "PI/1", "2-Apr-25", "50"]), OM, { asOfDate: "2026-10-31", direction: "payable" }, OUT)).id;
    expect(await pg.query(`select count(*)::int n from tally_documents`)).toMatchObject({ rows: [{ n: 10 }] });
    expect(await pg.query(`select count(*)::int n from vendor_masters`)).toMatchObject({ rows: [{ n: 2 }] });
    expect(await pg.query(`select count(*)::int n from tally_outstanding_lines`)).toMatchObject({ rows: [{ n: 4 }] });
  }, 60_000);

  it("each ledger shows only its own document type, with the right count", async () => {
    const v = await viewer();
    const expected: Record<string, string[]> = { "sales-orders": ["SO/1", "SO/2", "SO/3"], "sales-invoices": ["INV/1", "INV/2"], "purchase-invoices": ["PI/1"], "credit-notes": ["CN/1"], "debit-notes": ["DN/1"], "customer-receipts": ["RC/1"], "vendor-payments": ["PAY/1"] };
    for (const type of TALLY_DOCUMENT_TYPES) {
      const page = await ledger.listDocuments(v, type, readListParams({}, ledger.DOCUMENT_SORTS, { sort: "documentNo", dir: "asc" }));
      expect(page.storageReady).toBe(true);
      expect(page.total, type).toBe(expected[type]!.length);
      expect(page.rows.map((r) => r.documentNo).sort(), type).toEqual([...expected[type]!].sort());
      expect(page.rows.every((r) => r.documentType === type), type).toBe(true);
      const out = await html(pages.documents({ params: Promise.resolve({ type }), searchParams: sp() }));
      for (const no of expected[type]!) expect(out, type).toContain(no);
      // Another type's number may appear as a reference (an invoice names its order) but never as a row of this ledger.
      for (const other of Object.keys(expected).filter((k) => k !== type)) for (const no of expected[other]!) expect(out, `${type} must not list ${no}`).not.toMatch(new RegExp(`/forms/documents/${type}/[0-9a-f-]+">${no.replace("/", "\/")}<`));
    }
    // A document can't be opened under another ledger's URL.
    const [so] = (await ledger.listDocuments(v, "sales-orders", readListParams({}, ledger.DOCUMENT_SORTS, { sort: "documentNo", dir: "asc" }))).rows;
    expect(await ledger.getDocument(v, "sales-invoices", so!.id)).toBeNull();
    expect((await ledger.getDocument(v, "sales-orders", so!.id))?.document.documentNo).toBe("SO/1");
    expect(await outcome(pages.document({ params: Promise.resolve({ type: "credit-notes", id: so!.id }) }))).toBe("not found");
  });

  it("a document's page shows its complete record: party link, batch, reference both ways, lines, and the stored amounts", async () => {
    const v = await viewer();
    const inv = (await ledger.listDocuments(v, "sales-invoices", readListParams({ q: "INV/1" }, ledger.DOCUMENT_SORTS, { sort: "documentNo", dir: "asc" }))).rows[0]!;
    const detail = (await ledger.getDocument(v, "sales-invoices", inv.id))!;
    expect(detail.party).toMatchObject({ kind: "customer", name: "Alpha Traders", gstin: "27ABCDE1234F1Z5" });
    expect(detail.batch).toMatchObject({ id: batches.inv, category: "sales-invoices", uploadedBy: "admin", status: "completed" });
    expect(detail.refersTo).toMatchObject({ documentType: "sales-orders", documentNo: "SO/1", totalPaise: 100000 });
    expect(detail.referencedBy.map((r) => `${r.documentType}:${r.documentNo}`).sort()).toEqual(["credit-notes:CN/1", "customer-receipts:RC/1"]);
    const out = await html(pages.document({ params: Promise.resolve({ type: "sales-invoices", id: inv.id }) }));
    expect(out).toContain("₹1,000");
    expect(out).toContain(`/forms/documents/sales-orders/${detail.refersTo!.id}`);
    expect(out).toContain(`/forms/tally-import/batches/${batches.inv}`);
    expect(out).toContain("Referred to by");
    expect(out).toContain("CN/1");
    expect(out).toContain("2025-26 (historical)");
    // A purchase-side document links to the vendor's own page.
    const pi = (await ledger.listDocuments(v, "purchase-invoices", readListParams({}, ledger.DOCUMENT_SORTS, { sort: "documentNo", dir: "asc" }))).rows[0]!;
    expect(pi.vendorMasterId).toBeTruthy();
    expect(await html(pages.document({ params: Promise.resolve({ type: "purchase-invoices", id: pi.id }) }))).toContain(`/forms/vendor-master/${pi.vendorMasterId}`);
  });

  it("Vendor Master lists the imported vendors, searches, filters by batch, and the detail shows source and ledger links", async () => {
    const v = await viewer();
    const all = await ledger.listVendors(v, readListParams({}, ledger.VENDOR_SORTS, { sort: "name", dir: "asc" }));
    expect(all.total).toBe(2);
    expect(all.rows.map((r) => r.name)).toEqual(["Vendor One", "Vendor Two"]);
    expect(all.rows[0]).toMatchObject({ gstin: "27AAAAA0000A1Z5", state: "Maharashtra", importBatchId: batches.vendors, batchFileName: expect.stringContaining("vendor-master") });
    expect((await ledger.listVendors(v, readListParams({ q: "27AAAAA" }, ledger.VENDOR_SORTS, { sort: "name", dir: "asc" }))).rows.map((r) => r.name)).toEqual(["Vendor One"]);
    expect((await ledger.listVendors(v, readListParams({ q: "gujarat" }, ledger.VENDOR_SORTS, { sort: "name", dir: "asc" }))).total).toBe(0); // state isn't searched; it's a column
    expect((await ledger.listVendors(v, readListParams({ batch: batches.vendors }, ledger.VENDOR_SORTS, { sort: "name", dir: "asc" }))).total).toBe(2);
    expect((await ledger.listVendors(v, readListParams({ batch: batches.so }, ledger.VENDOR_SORTS, { sort: "name", dir: "asc" }))).total).toBe(0);
    const one = (await ledger.getVendor(v, all.rows[0]!.id))!;
    expect(one.batch?.id).toBe(batches.vendors);
    expect(Object.fromEntries(one.documents.map((d) => [d.type, d.n]))).toEqual({ "purchase-invoices": 1, "debit-notes": 1, "vendor-payments": 1 });
    expect(one.outstandingLines).toBe(1);
    const out = await html(pages.vendor({ params: Promise.resolve({ id: one.id }) }));
    expect(out).toContain("Vendor One");
    expect(out).toContain("27AAAAA0000A1Z5");
    expect(out).toContain(`/forms/tally-import/batches/${batches.vendors}`);
    expect(out).toContain("/forms/documents/purchase-invoices");
    expect(await html(pages.vendors({ searchParams: sp({ q: "Two" }) }))).toContain("1 vendor");
  });

  it("Outstanding: receivables show the newest completed snapshot and name it; an older one can be chosen; payables are separate", async () => {
    const v = await viewer();
    const rec = await ledger.listOutstanding(v, "receivable", readListParams({}, ledger.OUTSTANDING_SORTS, { sort: "pendingPaise", dir: "desc" }));
    expect(rec.snapshot).toMatchObject({ id: batches.recNew, asOfDate: "2026-10-31", direction: "receivable" });
    expect(rec.snapshots.map((s) => s.id)).toEqual([batches.recNew, batches.recOld]);
    expect(rec.total).toBe(1);
    expect(rec.rows[0]).toMatchObject({ partyName: "Alpha Traders", billRef: "INV/1", pendingPaise: 10000, direction: "receivable" });
    expect(rec.pendingPaise).toBe(10000);
    const old = await ledger.listOutstanding(v, "receivable", readListParams({ batch: batches.recOld }, ledger.OUTSTANDING_SORTS, { sort: "pendingPaise", dir: "desc" }));
    expect(old.snapshot?.id).toBe(batches.recOld);
    expect(old.rows.map((r) => r.partyName)).toEqual(["Beta Co", "Alpha Traders"]);
    expect(old.pendingPaise).toBe(260000);
    const pay = await ledger.listOutstanding(v, "payable", readListParams({}, ledger.OUTSTANDING_SORTS, { sort: "pendingPaise", dir: "desc" }));
    expect(pay.snapshot?.id).toBe(batches.pay1);
    expect(pay.rows.map((r) => `${r.direction}:${r.partyName}`)).toEqual(["payable:Vendor One"]);
    expect(pay.rows[0]!.vendorMasterId).toBeTruthy();
    // The payable snapshot is never offered on the receivables side, nor its lines under the wrong view.
    expect((await ledger.listOutstanding(v, "receivable", readListParams({ batch: batches.pay1 }, ledger.OUTSTANDING_SORTS, { sort: "pendingPaise", dir: "desc" }))).snapshot?.id).toBe(batches.recNew);
    expect(await ledger.getOutstandingLine(v, "receivable", pay.rows[0]!.id)).toBeNull();
    expect((await ledger.getOutstandingLine(v, "payable", pay.rows[0]!.id))?.party).toMatchObject({ kind: "vendor", name: "Vendor One" });
    const page = await html(pages.outstanding({ params: Promise.resolve({ view: "receivables" }), searchParams: sp() }));
    expect(page).toContain("Snapshot shown");
    expect(page).toContain("31/10/26");
    expect(page).toContain("latest");
    expect(page).toContain("Other snapshots");
    expect(page).not.toContain("Vendor One");
    const payPage = await html(pages.outstanding({ params: Promise.resolve({ view: "payables" }), searchParams: sp() }));
    expect(payPage).toContain("Vendor One");
    expect(payPage).not.toContain("Beta Co");
  });

  it("the receivable line's page shows the Collection Master match and its source batch", async () => {
    const v = await viewer();
    const rec = await ledger.listOutstanding(v, "receivable", readListParams({}, ledger.OUTSTANDING_SORTS, { sort: "pendingPaise", dir: "desc" }));
    const detail = (await ledger.getOutstandingLine(v, "receivable", rec.rows[0]!.id))!;
    expect(detail.collectionCompany?.name).toBe("Alpha Traders");
    expect(detail.party).toMatchObject({ kind: "customer", name: "Alpha Traders" });
    const out = await html(pages.line({ params: Promise.resolve({ view: "receivables", id: rec.rows[0]!.id }) }));
    expect(out).toContain("₹100");
    expect(out).toContain("Collection Master company");
    expect(out).toContain(`/forms/tally-import/batches/${batches.recNew}`);
    expect(await outcome(pages.line({ params: Promise.resolve({ view: "payables", id: rec.rows[0]!.id }) }))).toBe("not found");
  });

  it("filters, sorting and pagination run in the database", async () => {
    const v = await viewer();
    const list = (o: SearchParams) => ledger.listDocuments(v, "sales-orders", readListParams(o, ledger.DOCUMENT_SORTS, { sort: "documentDate", dir: "desc" }));
    expect((await list({ q: "so/2" })).rows.map((r) => r.documentNo)).toEqual(["SO/2"]);
    expect((await list({ q: "beta" })).rows.map((r) => r.documentNo)).toEqual(["SO/2"]);
    expect((await list({ q: "%" })).total).toBe(0); // a literal, not a wildcard
    expect((await list({ fy: "2024-25" })).rows.map((r) => r.documentNo)).toEqual(["SO/3"]);
    expect(await ledger.documentFinancialYears(v, "sales-orders")).toEqual(["2025-26", "2024-25"]);
    expect((await list({ from: "2025-05-01", to: "2025-05-31" })).rows.map((r) => r.documentNo)).toEqual(["SO/2"]);
    expect((await list({ batch: batches.inv })).total).toBe(0);
    expect((await list({ batch: batches.so })).total).toBe(3);
    expect((await list({ sort: "totalPaise", dir: "asc" })).rows.map((r) => r.totalPaise)).toEqual([50000, 100000, 250000]);
    expect((await list({ sort: "totalPaise", dir: "desc" })).rows.map((r) => r.totalPaise)).toEqual([250000, 100000, 50000]);
    expect((await list({})).rows.map((r) => r.documentNo)).toEqual(["SO/2", "SO/1", "SO/3"]); // newest first by default
    expect((await list({})).totalPaise).toBe(400000);
    expect((await list({ fy: "2024-25" })).totalPaise).toBe(50000); // the total follows the filter
    // Pagination: the smallest page size still holds these, so page 2 is empty but well-formed.
    const p2 = await list({ size: "25", page: "2" });
    expect(p2).toMatchObject({ rows: [], total: 3, page: 2, size: 25 });
    const out = await html(pages.documents({ params: Promise.resolve({ type: "sales-orders" }), searchParams: sp({ q: "nothing-like-this" }) }));
    expect(out).toContain("No sales orders match these filters.");
    expect(out).toContain("No documents");
    const batchOpts = await ledger.batchOptions(v, "sales-orders");
    expect(batchOpts.map((b) => b.id)).toEqual([batches.so]);
  });

  it("Import History drills into a batch: every row with its status, reason and a link into the right Forms section", async () => {
    const v = await viewer();
    const detail = (await ledger.getBatchDetail(v, batches.so!))!;
    expect(detail.batch).toMatchObject({ category: "sales-orders", uploadedBy: "admin", status: "completed", importedRows: 3 });
    expect(detail.counts).toEqual({ imported: 3, skipped: 0, rejected: 0, failed: 0 });
    const all = await ledger.listBatchRows(v, batches.so!, readListParams({}, ledger.BATCH_ROW_SORTS, { sort: "rowNo", dir: "asc" }));
    expect(all.rows.map((r) => r.rowNo)).toEqual([2, 3, 4]);
    expect(all.rows.every((r) => r.status === "imported" && r.targetTable === "tally_documents" && r.targetId)).toBe(true);
    expect((await ledger.listBatchRows(v, batches.so!, readListParams({ status: "rejected" }, ledger.BATCH_ROW_SORTS, { sort: "rowNo", dir: "asc" }))).total).toBe(0);
    expect((await ledger.listBatchRows(v, batches.so!, readListParams({ q: "beta" }, ledger.BATCH_ROW_SORTS, { sort: "rowNo", dir: "asc" }))).rows.map((r) => r.rowNo)).toEqual([3]);
    const out = await html(pages.batch({ params: Promise.resolve({ id: batches.so! }), searchParams: sp() }));
    expect(out).toContain("Sales Orders");
    for (const r of all.rows) expect(out).toContain(`/forms/documents/sales-orders/${r.targetId}`);
    expect(out).toContain("Open Sales Orders");
    expect(out).toContain("Voucher No."); // the file's own headings
    // A rejected row keeps its reason and has no destination.
    const bad = await run("sales-orders", rows(["", "1-Apr-25", "Alpha Traders", "10"]), M);
    expect(bad.rejectedRows).toBe(1);
    const badRows = await ledger.listBatchRows(v, bad.id, readListParams({}, ledger.BATCH_ROW_SORTS, { sort: "rowNo", dir: "asc" }));
    expect(badRows.rows[0]).toMatchObject({ status: "rejected", targetId: null });
    expect(badRows.rows[0]!.reason).toBeTruthy();
    const badOut = await html(pages.batch({ params: Promise.resolve({ id: bad.id }), searchParams: sp({ status: "rejected" }) }));
    expect(badOut).toContain("rejected");
    expect(badOut).toContain(badRows.rows[0]!.reason!);
    // The outstanding batch links its lines to the matching side.
    const recRows = await ledger.listBatchRows(v, batches.recNew!, readListParams({}, ledger.BATCH_ROW_SORTS, { sort: "rowNo", dir: "asc" }));
    expect(await html(pages.batch({ params: Promise.resolve({ id: batches.recNew! }), searchParams: sp() }))).toContain(`/forms/outstanding/receivables/${recRows.rows[0]!.targetId}`);
  }, 30_000);

  it("the overview counts what the sections hold", async () => {
    const out = await html(pages.overview());
    expect(out).toContain("2 vendors");
    expect(out).toContain("3 documents"); // sales orders
    expect(out).toContain("1 receivable · 1 payable lines");
    expect(out).toContain("/forms/tally-import");
    expect(out).toContain("/forms/customer-master");
  });

  it("viewing creates nothing: the row counts are what the imports left", async () => {
    expect(await pg.query(`select count(*)::int n from tally_documents`)).toMatchObject({ rows: [{ n: 10 }] });
    expect(await pg.query(`select count(*)::int n from vendor_masters`)).toMatchObject({ rows: [{ n: 2 }] });
    expect(await pg.query(`select count(*)::int n from tally_outstanding_lines`)).toMatchObject({ rows: [{ n: 4 }] });
    expect(await pg.query(`select count(*)::int n from customer_masters`)).toMatchObject({ rows: [{ n: 2 }] });
  });
});

describe("access, through the real resolver and real grant rows", () => {
  it("a member of staff without Forms is bounced from every section; granting opens the viewing sections; revoking closes them", async () => {
    asStaff();
    const everySection = () => [
      pages.overview(),
      pages.vendors({ searchParams: sp() }),
      pages.documents({ params: Promise.resolve({ type: "sales-invoices" }), searchParams: sp() }),
      pages.outstanding({ params: Promise.resolve({ view: "payables" }), searchParams: sp() }),
      pages.customers(),
      pages.tally(),
      pages.batch({ params: Promise.resolve({ id: batches.so! }), searchParams: sp() }),
    ];
    for (const p of everySection()) expect(await outcome(p)).toBe("/hub?denied=forms");
    expect(await access.getFormsViewer()).toBeNull();
    await grantForms(staff);
    expect(await outcome(pages.overview())).toBe("opens");
    expect(await html(pages.vendors({ searchParams: sp() }))).toContain("Vendor One");
    expect(await html(pages.documents({ params: Promise.resolve({ type: "sales-invoices" }), searchParams: sp() }))).toContain("INV/1");
    expect(await html(pages.outstanding({ params: Promise.resolve({ view: "payables" }), searchParams: sp() }))).toContain("Vendor One");
    expect(await access.getFormsViewer()).toMatchObject({ employeeId: staff });
    await clearGrants();
    for (const p of everySection()) expect(await outcome(p)).toBe("/hub?denied=forms");
  });

  it("Forms access alone does not open Customer Master, Tally Data Import or a batch (admin), nor let anyone import", async () => {
    asStaff();
    await grantForms(staff);
    expect(await outcome(pages.customers())).toBe("Forbidden");
    expect(await outcome(pages.tally())).toBe("Forbidden");
    expect(await outcome(pages.batch({ params: Promise.resolve({ id: batches.so! }), searchParams: sp() }))).toBe("Forbidden");
    await expect(actions.startTallyImport({})).rejects.toThrow("Forbidden");
    await expect(actions.checkTallyChunk({})).rejects.toThrow("Forbidden");
    await expect(actions.getTallyBatchProblems(batches.so)).rejects.toThrow("Forbidden");
    // Even with a stray tally.import grant, a non-admin can't import.
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [staff]);
    await expect(actions.startTallyImport({})).rejects.toThrow("Forbidden");
    await pg.query(`delete from field_permission_grants where subject_id = $1`, [staff]);
    expect(await pg.query(`select count(*)::int n from tally_import_batches where created_by_id = $1`, [staff])).toMatchObject({ rows: [{ n: 0 }] });
  });

  it("an admin denied Forms in Access loses the sections and the import actions, grant or no grant", async () => {
    asAdmin();
    expect(await outcome(pages.tally())).toBe("opens");
    await grantForms(admin, false);
    expect(await outcome(pages.tally())).toBe("/hub?denied=forms");
    expect(await outcome(pages.customers())).toBe("/hub?denied=forms");
    expect(await outcome(pages.documents({ params: Promise.resolve({ type: "sales-orders" }), searchParams: sp() }))).toBe("/hub?denied=forms");
    await expect(actions.startTallyImport({})).rejects.toThrow("Forbidden");
    await expect(actions.checkTallyChunk({})).rejects.toThrow("Forbidden");
    await expect(actions.getSavedTallyMapping("sales-orders")).rejects.toThrow("Forbidden");
    await expect(actions.getTallyBatchProblems(batches.so)).rejects.toThrow("Forbidden");
    await clearGrants();
    expect(await outcome(pages.tally())).toBe("opens");
  });

  it("an admin with Forms but without tally.import can open the import page and the ledgers, but cannot import", async () => {
    await pg.query(`delete from field_permission_grants where subject_id = $1`, [admin]);
    expect(await outcome(pages.tally())).toBe("opens");
    await expect(actions.startTallyImport({})).rejects.toThrow("Forbidden");
    await expect(actions.importTallyChunk({})).rejects.toThrow("Forbidden");
    expect(await actions.getTallyBatchProblems(batches.so)).toEqual([]); // the history stays readable
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [admin]);
    const started = await actions.startTallyImport({ category: "sales-orders", fileName: "x.csv", fileHash: hash(), sheetName: null, headers: VOUCHER, sample: [], mapping: M, totalRows: 1, asOfDate: null, direction: null, includeAttention: false, confirm: true });
    expect(started.ok).toBe(true);
    expect(uuidsIn(JSON.stringify(started))).toHaveLength(1);
  });
});
