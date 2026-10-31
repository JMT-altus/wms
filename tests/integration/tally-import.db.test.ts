import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite, running migration 0122's own SQL) for Tally import, through the real server
// actions. Invented data only. Nothing here can reach a shared or production database; only the session is mocked.
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

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let actions: typeof import("@/app/(forms-module)/forms/tally-import/actions");
let queries: typeof import("@/lib/queries/tally-import");
let grantee: string;
let other: string;

const count = async (t: string) => (await pg.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0]!.n;
const rows = (...r: string[][]): RawRow[] => r.map((cells, i) => ({ rowNo: i + 2, cells }));
const VOUCHER = ["Voucher No.", "Date", "Party", "Amount", "Against"];
const M = { documentNo: 0, documentDate: 1, partyName: 2, amount: 3 };
let seq = 0;
const hash = () => String(++seq).padStart(64, "0");

async function run(category: TallyCategoryKey, data: RawRow[], mapping: Record<string, number>, over: Record<string, unknown> = {}, headers = VOUCHER) {
  const fileHash = (over.fileHash as string) ?? hash();
  const started = await actions.startTallyImport({ category, fileName: `${category}.csv`, sheetName: "S", headers, sample: data.slice(0, 20), mapping, totalRows: data.length, asOfDate: null, direction: null, includeAttention: true, confirm: true, ...over, ...{ fileHash } });
  if (!started.ok) return { started, batch: null };
  const plan = planRows(category, data, mapping, { today: "2026-10-31", asOfDate: (over.asOfDate as string) ?? null, direction: (over.direction as "receivable") ?? null });
  for (const c of chunkRows(data.filter((r) => !started.doneRowNos.includes(r.rowNo)), plan.rows)) await actions.importTallyChunk({ batchId: started.batchId, rows: c });
  const done = await actions.finishTallyImport(started.batchId);
  return { started, batch: done.ok ? done.batch : null };
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
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec("create sequence if not exists customer_masters_code_seq start 1");
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0122_tally_import.sql"), "utf8"));
  const emp = async (name: string) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [name, `${name}@example.test`])).rows[0]!.id;
  grantee = await emp("granted");
  other = await emp("other");
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [grantee]);
  await pg.query(`insert into customer_masters (name, gstin) values ('Alpha Traders', '27ABCDE1234F1Z5')`);
  await pg.query(`insert into collection_master_companies (company_name, name_key) values ('Alpha Traders', 'alphatraders')`);
  actions = await import("@/app/(forms-module)/forms/tally-import/actions");
  queries = await import("@/lib/queries/tally-import");
}, 120_000);
afterAll(async () => {
  await pg.close();
});
beforeEach(() => {
  h.me = { id: grantee, email: "granted@example.test", name: "granted", isActive: true, isAdmin: true, departmentId: null };
});

describe("migration 0122", () => {
  it("creates the tables, is safe to re-run, and leaves them closed by RLS", async () => {
    await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0122_tally_import.sql"), "utf8"));
    const r = await pg.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname in ('tally_import_batches','tally_import_rows','tally_column_mappings','vendor_masters','tally_documents','tally_outstanding_lines')`);
    expect(r.rows).toHaveLength(6);
    expect(r.rows.every((x) => x.relrowsecurity)).toBe(true);
  });

  it("the drizzle schema matches the SQL closely enough to read every table", async () => {
    expect((await queries.listHistory()).storageReady).toBe(true);
  });
});

describe("permissions", () => {
  it("an admin without the grant can't validate, start, write or finish; history stays readable", async () => {
    h.me = { id: other, email: "other@example.test", name: "other", isActive: true, isAdmin: true, departmentId: null };
    await expect(actions.checkTallyChunk({ category: "sales-invoices", mapping: M, rows: [], asOfDate: null, direction: null })).rejects.toThrow("Forbidden");
    await expect(actions.startTallyImport({})).rejects.toThrow("Forbidden");
    await expect(actions.importTallyChunk({})).rejects.toThrow("Forbidden");
    await expect(actions.finishTallyImport("x")).rejects.toThrow("Forbidden");
    expect(await actions.getTallyBatchProblems("00000000-0000-4000-8000-000000000000")).toEqual([]);
  });

  it("a non-admin holding a stray grant is refused, and one person can't write into another's batch", async () => {
    const started = await actions.startTallyImport({ category: "sales-orders", fileName: "a.csv", fileHash: hash(), sheetName: null, headers: VOUCHER, sample: [], mapping: M, totalRows: 1, asOfDate: null, direction: null, includeAttention: false, confirm: true });
    expect(started.ok).toBe(true);
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('tally.import', 'employee', $1, true)`, [other]);
    h.me = { id: other, email: "other@example.test", name: "other", isActive: true, isAdmin: true, departmentId: null };
    const res = await actions.importTallyChunk({ batchId: (started as { batchId: string }).batchId, rows: rows(["1", "1-Apr-25", "A", "1"]) });
    expect(res).toEqual({ ok: false, error: "That import wasn't found." });
    await pg.query(`delete from field_permission_grants where subject_id = $1`, [other]);
    h.me = { ...h.me, isAdmin: false };
    await expect(actions.startTallyImport({})).rejects.toThrow("Forbidden");
  });

  it("needs an explicit confirmation", async () => {
    const res = await actions.startTallyImport({ category: "sales-orders", fileName: "a.csv", fileHash: hash(), sheetName: null, headers: VOUCHER, sample: [], mapping: M, totalRows: 1, asOfDate: null, direction: null, includeAttention: false });
    expect(res.ok).toBe(false);
  });
});

describe("masters", () => {
  const H = ["Name", "GSTIN"];
  it("customers: existing ones are left untouched; new ones join the Customer Master with a code", async () => {
    const before = await count("customer_masters");
    const { batch } = await run("customer-master", rows(["ALPHA TRADERS", ""], ["Beta Works", "29ABCDE1234F1Z5"], ["Beta Works", "29ABCDE1234F1Z5"]), { name: 0, gstin: 1 }, {}, H);
    expect(batch).toMatchObject({ status: "completed", totalRows: 3, importedRows: 1, skippedRows: 2 });
    expect(await count("customer_masters")).toBe(before + 1);
    const b = (await pg.query<{ code: string; kyc_stage: string; notes: string }>(`select code, kyc_stage, notes from customer_masters where name = 'Beta Works'`)).rows[0]!;
    expect(b.code).toMatch(/^\d{5}$/);
    expect(b.kyc_stage).toBe("complete"); // a draft would be swept into the Recycle Bin after 7 days
    expect(b.notes).toContain(batch!.id);
    expect((await pg.query(`select 1 from customer_masters where name = 'Alpha Traders' and gstin = '27ABCDE1234F1Z5'`)).rows).toHaveLength(1);
  });

  it("vendors: a repeat import adds nothing", async () => {
    await run("vendor-master", rows(["Gamma Supplies", ""]), { name: 0 }, {}, H);
    const n = await count("vendor_masters");
    const { batch } = await run("vendor-master", rows(["gamma supplies", ""]), { name: 0 }, {}, H);
    expect(batch).toMatchObject({ importedRows: 0, skippedRows: 1 });
    expect(await count("vendor_masters")).toBe(n);
  });
});

describe("vouchers", () => {
  it.each(["sales-orders", "sales-invoices", "purchase-invoices", "credit-notes", "debit-notes", "customer-receipts", "vendor-payments"] as TallyCategoryKey[])("%s: imports, traceable to its file and row, and a repeat import creates nothing", async (c) => {
    const data = rows([`${c}-1`, "15-Apr-25", "Alpha Traders", "1,000.50"]);
    const { batch } = await run(c, data, M);
    expect(batch).toMatchObject({ status: "completed", importedRows: 1, financialYears: ["2025-26"], isHistorical: true });
    const d = (await pg.query<Record<string, unknown>>(`select * from tally_documents where document_no = $1`, [`${c}-1`])).rows[0]!;
    expect(d).toMatchObject({ document_type: c, financial_year: "2025-26", import_batch_id: batch!.id, source_row: 2, is_historical: true });
    expect(Number(d.total_paise)).toBe(100050);
    const n = await count("tally_documents");
    const again = await run(c, data, M);
    expect(again.batch).toMatchObject({ importedRows: 0, skippedRows: 1, status: "completed" });
    expect(await count("tally_documents")).toBe(n);
  });

  it("links customers by name, and keeps an unknown party unlinked and flagged", async () => {
    await run("sales-invoices", rows(["L-1", "1-May-25", "alpha traders", "10"], ["L-2", "1-May-25", "Nobody Ltd", "10"]), M);
    const r = await pg.query<{ document_no: string; customer_master_id: string | null }>(`select document_no, customer_master_id from tally_documents where document_no in ('L-1','L-2') order by 1`);
    expect(r.rows[0]!.customer_master_id).toBeTruthy();
    expect(r.rows[1]!.customer_master_id).toBeNull();
  });

  it("without the opt-in, attention rows are skipped with the reason and validation says so", async () => {
    const data = rows(["H-1", "1-May-25", "Nobody Ltd", "10"]);
    const check = await actions.checkTallyChunk({ category: "sales-invoices", mapping: M, rows: data, asOfDate: null, direction: null });
    expect(check.ok && check.rows[0]).toMatchObject({ state: "attention" });
    const { batch } = await run("sales-invoices", data, M, { includeAttention: false });
    expect(batch).toMatchObject({ importedRows: 0, skippedRows: 1 });
    expect((await actions.getTallyBatchProblems(batch!.id))[0]!.reason).toMatch(/Needs attention/);
  });

  it("a credit note links to its original invoice, and an unknown original is reported", async () => {
    await run("sales-invoices", rows(["CN-BASE", "1-Jun-25", "Alpha Traders", "500"]), M);
    await run("credit-notes", rows(["CN-1", "2-Jun-25", "Alpha Traders", "100", "CN-BASE"], ["CN-2", "2-Jun-25", "Alpha Traders", "100", "MISSING"]), { ...M, refDocumentNo: 4 });
    const r = await pg.query<{ document_no: string; ref_document_id: string | null; ref_document_no: string }>(`select document_no, ref_document_id, ref_document_no from tally_documents where document_no in ('CN-1','CN-2') order by 1`);
    expect(r.rows[0]!.ref_document_id).toBeTruthy();
    expect(r.rows[1]).toMatchObject({ ref_document_id: null, ref_document_no: "MISSING" });
  });

  it("a changed document is refused and the stored record stays exactly as it was", async () => {
    await run("sales-invoices", rows(["X-1", "1-Jul-25", "Alpha Traders", "100"]), M);
    const { batch } = await run("sales-invoices", rows(["X-1", "1-Jul-25", "Alpha Traders", "999"]), M);
    expect(batch).toMatchObject({ importedRows: 0, rejectedRows: 1 });
    expect((await actions.getTallyBatchProblems(batch!.id))[0]!.reason).toMatch(/never overwritten/);
    expect(Number((await pg.query<{ total_paise: string }>(`select total_paise from tally_documents where document_no = 'X-1'`)).rows[0]!.total_paise)).toBe(10000);
  });

  it("two financial years in separate files coexist, and neither replaces the other", async () => {
    await run("sales-invoices", rows(["FY-1", "1-Mar-25", "Alpha Traders", "1"]), M);
    await run("sales-invoices", rows(["FY-1", "1-Apr-25", "Alpha Traders", "2"]), M);
    expect((await pg.query(`select 1 from tally_documents where document_no = 'FY-1'`)).rows).toHaveLength(2);
  });

  it("never touches the Incentive Tracker's inputs, and the feed reads what was imported", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/queries/tally-import.ts"), "utf8");
    expect(src).not.toMatch(/\.(insert|update|delete)\((salesOrders|invoices|receipts)\b/);
    expect(src).not.toMatch(/import \{[^}]*\b(salesOrders|invoices|receipts)\b[^}]*\} from "@\/db\/schema"/);
  });

  it("the incentive feed is read-only and limited to the sales side", async () => {
    const feed = await queries.listIncentiveFeed("2025-04-01", "2026-03-31");
    expect(feed.length).toBeGreaterThan(0);
    expect(new Set(feed.map((f) => f.documentType))).not.toContain("purchase-invoices");
  });
});

describe("interrupted imports", () => {
  it("resumes the same file, finishing only what's left, with nothing doubled", async () => {
    const data = rows(["R-1", "1-Aug-25", "Alpha Traders", "1"], ["R-2", "1-Aug-25", "Alpha Traders", "2"]);
    const fileHash = hash();
    const first = await actions.startTallyImport({ category: "sales-invoices", fileName: "r.csv", fileHash, sheetName: null, headers: VOUCHER, sample: data, mapping: M, totalRows: 2, asOfDate: null, direction: null, includeAttention: true, confirm: true });
    expect(first.ok).toBe(true);
    const batchId = (first as { batchId: string }).batchId;
    await actions.importTallyChunk({ batchId, rows: [data[0]] });
    // The browser dies here. The batch is left running.
    const { started, batch } = await run("sales-invoices", data, M, { fileHash });
    expect(started).toMatchObject({ ok: true, batchId, resumed: true, doneRowNos: [2] });
    expect(batch).toMatchObject({ id: batchId, status: "completed", importedRows: 2 });
    expect((await pg.query(`select 1 from tally_documents where document_no in ('R-1','R-2')`)).rows).toHaveLength(2);
  });

  it("repeating a chunk logs and imports nothing twice", async () => {
    const data = rows(["D-1", "1-Aug-25", "Alpha Traders", "1"]);
    const s = (await actions.startTallyImport({ category: "sales-invoices", fileName: "d.csv", fileHash: hash(), sheetName: null, headers: VOUCHER, sample: data, mapping: M, totalRows: 1, asOfDate: null, direction: null, includeAttention: true, confirm: true })) as { batchId: string };
    await actions.importTallyChunk({ batchId: s.batchId, rows: data });
    await actions.importTallyChunk({ batchId: s.batchId, rows: data });
    expect((await pg.query(`select 1 from tally_import_rows where batch_id = $1`, [s.batchId])).rows).toHaveLength(1);
    expect((await pg.query(`select 1 from tally_documents where document_no = 'D-1'`)).rows).toHaveLength(1);
  });

  it("a failed chunk leaves no partial record, is reported as partial, and a retry completes it", async () => {
    const fileHash = hash();
    const good = rows(["P-1", "1-Sep-25", "Alpha Traders", "1"]);
    const bad = [{ rowNo: 3, cells: ["P-2", "1-Sep-25", "Alpha Traders", "2"] }];
    const s = (await actions.startTallyImport({ category: "sales-invoices", fileName: "p.csv", fileHash, sheetName: null, headers: VOUCHER, sample: good, mapping: M, totalRows: 2, asOfDate: null, direction: null, includeAttention: true, confirm: true })) as { batchId: string };
    await actions.importTallyChunk({ batchId: s.batchId, rows: good });
    await pg.exec("alter table tally_documents add constraint block check (document_no <> 'P-2')");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await actions.importTallyChunk({ batchId: s.batchId, rows: bad })).toEqual({ ok: false, error: "Part of the file couldn't be saved." });
    err.mockRestore();
    const done = await actions.finishTallyImport(s.batchId);
    expect(done.ok && done.batch).toMatchObject({ status: "partial", importedRows: 1, failedRows: 1 });
    await pg.exec("alter table tally_documents drop constraint block");
    const { started, batch } = await run("sales-invoices", [...good, ...bad], M, { fileHash });
    expect(started).toMatchObject({ resumed: true, doneRowNos: [2] });
    expect(batch).toMatchObject({ status: "completed", importedRows: 2, failedRows: 0 });
  });

  it("the database itself refuses a duplicate document and deleting an import's batch", async () => {
    await expect(pg.query(`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, total_paise, import_batch_id, source_row) select identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, total_paise, import_batch_id, source_row from tally_documents limit 1`)).rejects.toThrow(/duplicate key/);
    await expect(pg.query(`delete from tally_import_batches`)).rejects.toThrow(/foreign key/);
  });
});

describe("outstanding balances", () => {
  const H = ["Party", "Bill", "Pending", "Due"];
  const OM = { partyName: 0, billRef: 1, pendingAmount: 2, dueDate: 3 };
  const rec = { asOfDate: "2026-09-30", direction: "receivable" };

  it("stays separate from documents, links to the Collection Master, and a repeat file is refused", async () => {
    const docs = await count("tally_documents");
    const data = rows(["Alpha Traders", "B-1", "1,000.00", "30-Oct-26"], ["Unknown Co", "B-2", "5.00", ""]);
    const hashValue = hash();
    const { batch } = await run("outstanding-balances", data, OM, { ...rec, fileHash: hashValue }, H);
    expect(batch).toMatchObject({ status: "completed", importedRows: 2, asOfDate: "2026-09-30" });
    expect(await count("tally_documents")).toBe(docs);
    const { started } = await run("outstanding-balances", data, OM, { ...rec, fileHash: hashValue }, H);
    expect(started).toMatchObject({ ok: false, error: expect.stringMatching(/already imported/) });
  });

  it("the Collection source reads only the newest completed snapshot, never a sum, and stays off until approved", async () => {
    const company = (await pg.query<{ id: string }>(`select id from collection_master_companies limit 1`)).rows[0]!.id;
    await run("outstanding-balances", rows(["Alpha Traders", "B-9", "250.00", ""]), OM, { asOfDate: "2026-10-15", direction: "receivable" }, H);
    const { listTallyBills } = await import("@/lib/collections/tally-source");
    expect(await listTallyBills([company])).toEqual([{ id: expect.any(String), collectionMasterId: company, reference: "B-9", amount: null, outstanding: 250, dueDate: null, status: null }]);

    const { activeTransactionSource } = await import("@/lib/collections/transactions");
    expect(activeTransactionSource().approved).toBe(false);
    process.env.COLLECTION_TRANSACTION_SOURCE = "tally-bills";
    expect(activeTransactionSource()).toMatchObject({ key: "tally-bills", approved: true });
    delete process.env.COLLECTION_TRANSACTION_SOURCE;
  });

  it("a payable snapshot links to vendors and never reaches the Collection source", async () => {
    const { batch } = await run("outstanding-balances", rows(["Gamma Supplies", "V-1", "70.00", ""]), OM, { asOfDate: "2026-10-20", direction: "payable" }, H);
    expect(batch).toMatchObject({ importedRows: 1 });
    const r = (await pg.query<{ vendor_master_id: string | null; collection_company_id: string | null }>(`select vendor_master_id, collection_company_id from tally_outstanding_lines where bill_ref = 'V-1'`)).rows[0]!;
    expect(r.vendor_master_id).toBeTruthy();
    expect(r.collection_company_id).toBeNull();
  });
});

describe("history and mappings", () => {
  it("counts come from recorded rows, and the uploader and file are kept", async () => {
    const { batch } = await run("customer-receipts", rows(["HR-1", "1-Oct-25", "Alpha Traders", "5"], ["HR-2", "1-Oct-25", "Alpha Traders", "5"], ["HR-3", "1-Oct-25", "Alpha Traders", "5"], ["HR-4", "1-Oct-25", "Alpha Traders", "5"], ["", "bad", "", ""]), M);
    expect(batch).toMatchObject({ totalRows: 5, importedRows: 4, rejectedRows: 1, status: "completed" });
    const stored = (await pg.query<{ n: number }>(`select count(*)::int as n from tally_import_rows where batch_id = $1`, [batch!.id])).rows[0]!.n;
    expect(stored).toBe(5);
    const { rows: history } = await queries.listHistory();
    expect(history.find((b) => b.id === batch!.id)).toMatchObject({ uploadedBy: "granted", fileName: "customer-receipts.csv" });
  });

  it("the confirmed mapping is saved per category, by heading", async () => {
    await run("debit-notes", rows(["SM-1", "1-Oct-25", "Gamma Supplies", "5"]), M);
    expect(await actions.getSavedTallyMapping("debit-notes")).toMatchObject({ documentNo: "Voucher No.", amount: "Amount" });
  });

  it("an unusable mapping can't start an import", async () => {
    const res = await actions.startTallyImport({ category: "sales-orders", fileName: "a.csv", fileHash: hash(), sheetName: null, headers: VOUCHER, sample: [], mapping: { documentNo: 0 }, totalRows: 1, asOfDate: null, direction: null, includeAttention: false, confirm: true });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/mapping isn't complete/) });
  });
});
