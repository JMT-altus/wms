import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// Category A GOLDEN MASTER (service level, REAL Postgres via PGlite). One complete Category A month through the
// services exactly as the screens drive them — calculate from Forms, recalculate, lock, a later refund carried as a
// difference, submit, two approvals, payout — and a snapshot of EVERYTHING stored: runs (inputs, result, outcome,
// adoption, engine and configuration version), results, order and receipt credits, adjustments, periods, approvals,
// payout and payout lines, and the audit trail. Captured BEFORE any Category B change; every later change must
// reproduce it exactly, first on the database as production has it today (0131–0133) and, once it exists, with
// migration 0134 applied too.
//
// PGlite makes fresh UUIDs and timestamps on every run, so those are replaced by stable labels (document numbers,
// names, run order) before comparing; the exact hashes of the same inputs are guarded by the engine-level golden test.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean; departmentId: null; role: string } };
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
import { aprilConfig, EXAMPLE_2, L, type Pay } from "../fixtures/category-a";

const FILE = resolve(__dirname, "../fixtures/golden/category-a-service.json");
const MIG = resolve(__dirname, "../../db/migrations");
const BASE = ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"];
const next = readdirSync(MIG).find((f) => f.startsWith("0134_"));
const VARIANTS: [string, string[]][] = [["0131–0133 (production today)", BASE], ...(next ? ([[`0131–0134 (with ${next})`, [...BASE, next]]] as [string, string[]][]) : [])];

const PEOPLE = ["runner", "locker", "a1", "a2", "payer", "rep", "author", "checker"] as const;
type Who = (typeof PEOPLE)[number];
const GRANTS: Partial<Record<Who, string[]>> = { runner: ["run"], locker: ["lock", "submit"], a1: ["approve"], a2: ["approve"], payer: ["pay"] };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

async function flow(migrations: string[]) {
  const made = await createTestDb({
    employees: schema.employees,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    customerMasters: schema.customerMasters,
    vendorMasters: schema.vendorMasters,
    tallyImportBatches: schema.tallyImportBatches,
    tallyDocuments: schema.tallyDocuments,
    salesOrderPreclosures: schema.salesOrderPreclosures,
    products: schema.products,
    incentiveAudit: schema.incentiveAudit,
  });
  const pg = made.pg;
  h.db = made.db;
  const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
  const who = {} as Record<Who, string>;
  for (const k of PEOPLE) who[k] = (await q1<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k}@example.test`, k !== "rep"]))[0]!.id;
  for (const [k, rights] of Object.entries(GRANTS)) for (const r of rights!) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [`incentive.calc.${r}`, who[k as Who]]);
  for (const f of migrations) await pg.exec(readFileSync(resolve(MIG, f), "utf8"));
  const customer = (await q1<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Customer One', $1, 30) returning id`, [who.rep]))[0]!.id;
  const batch = (await q1<{ id: string }>(`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'test.xlsx', 'x') returning id`))[0]!.id;
  const doc = async (type: string, no: string, date: string, total: number, extra: Record<string, unknown> = {}) =>
    (
      await q1<{ id: string }>(
        `insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row)
         values ($1, $2, $3, $4, $5, '2026-27', 'Customer One', 'customer one', $6, $7, $7, $8, $9, $10, $11, 1) returning id`,
        [`${type}|${no}`, type, no, no.toLowerCase(), date, customer, total, extra.ref ?? null, extra.due ?? null, JSON.stringify(extra.lines ?? []), batch],
      )
    )[0]!.id;
  const day = (d: number) => new Date(Date.parse("2026-04-05T00:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);
  for (const [i, pays] of (EXAMPLE_2 as Pay[][]).entries()) {
    const order = await doc("sales-orders", `SO ${i + 1}`, "2026-04-05", L(10), { lines: [{ item: "Drive", quantity: 1, ratePaise: L(10), amountPaise: L(10) }] });
    const inv = await doc("sales-invoices", `INV ${i + 1}`, "2026-04-05", L(10), { ref: order, due: "2026-04-05" });
    for (const [k, [fraction, d]] of pays.entries()) await doc("customer-receipts", `RC ${i + 1}.${k + 1}`, day(d), Math.round(L(10) * fraction), { ref: inv });
  }

  const act = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  const rules = await import("@/lib/queries/incentive-rules");
  const as = (k: Who) => {
    h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: k !== "rep", departmentId: null, role: "both" };
  };
  const p = await rules.createProgram({ id: who.author, name: "author" }, { code: "SALES", name: "Sales team", description: null });
  if (!p.ok) throw new Error(p.error);
  const programId = p.programId;
  const config = { ...aprilConfig(), eligibility: [{ subjectType: "employee" as const, subjectId: who.rep, role: null, subjectLabel: "rep", mode: "include" as const, effectiveFrom: "2026-01-01", effectiveTo: null }] };
  const d = await rules.createDraft({ id: who.author, name: "author" }, { programId, category: "A", startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft({ id: who.author, name: "author" }, d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit({ id: who.author, name: "author" }, d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve({ id: who.checker, name: "checker" }, d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish({ id: who.checker, name: "checker" }, d.versionId, ap.rowVersion, "2026-04-01", { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);

  const steps: unknown[] = [];
  const rv = async () => (await q1<{ row_version: number }>(`select row_version from incentive_calc_periods where month = '2026-04-01'`))[0]!.row_version;
  as("runner");
  steps.push(["calculate", await act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-09-30" })]);
  steps.push(["calculate again", await act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-09-30" })]);
  as("locker");
  steps.push(["lock", await act.setCategoryAMonthLocked({ programId, month: "2026-04-01", lock: true, rowVersion: await rv() })]);
  const rc = (await q1<{ id: string }>(`select id from tally_documents where document_no = 'RC 4.1'`))[0]!.id;
  await pg.query(`insert into incentive_calc_receipt_events (document_id, kind, amount_paise, event_date) values ($1, 'refund', $2, '2026-10-01')`, [rc, L(5)]);
  as("runner");
  steps.push(["recalculate a locked month", await act.calculateCategoryAMonth({ programId, month: "2026-04-01", asOf: "2026-10-05" })]);
  steps.push(["calculate October (open)", await act.calculateCategoryAMonth({ programId, month: "2026-10-01", asOf: "2026-10-31" })]);
  as("locker");
  steps.push(["submit", await act.submitCategoryAMonth({ programId, month: "2026-04-01", rowVersion: await rv() })]);
  as("a1");
  steps.push(["approve 1", await act.decideCategoryAMonth({ programId, month: "2026-04-01", rowVersion: await rv(), decision: "approve", reason: null })]);
  as("a2");
  steps.push(["approve 2", await act.decideCategoryAMonth({ programId, month: "2026-04-01", rowVersion: await rv(), decision: "approve", reason: "fine" })]);
  const release = (await q1<{ r: string }>(`select release_on::text r from incentive_calc_periods where month = '2026-04-01'`))[0]!.r;
  as("payer");
  steps.push(["pay", await act.recordCategoryAPayout({ programId, month: "2026-04-01", rowVersion: await rv(), reference: "PAY-APR", paidOn: release, amountPaise: 92500, note: null })]);

  // Labels for every id, so the snapshot reads the same whatever UUIDs PGlite made.
  const labels = new Map<string, string>();
  for (const r of await q1<{ id: string; document_no: string }>(`select id, document_no from tally_documents`)) labels.set(r.id, `doc:${r.document_no}`);
  for (const k of PEOPLE) labels.set(who[k], `emp:${k}`);
  labels.set(programId, "program:SALES");
  labels.set(customer, "customer:Customer One");
  labels.set(batch, "batch");
  for (const r of await q1<{ id: string; version_no: number }>(`select id, version_no from incentive_config_versions`)) labels.set(r.id, `version:${r.version_no}`);
  for (const [i, r] of (await q1<{ id: string }>(`select id from incentive_calc_runs order by computed_at, month, outcome`)).entries()) labels.set(r.id, `run:${i + 1}`);
  for (const r of await q1<{ id: string; month: string }>(`select id, month::text from incentive_calc_periods`)) labels.set(r.id, `period:${r.month}`);
  for (const r of await q1<{ id: string }>(`select id from incentive_calc_receipt_events`)) labels.set(r.id, "event:refund");
  for (const [i, r] of (await q1<{ id: string }>(`select id from incentive_calc_payouts`)).entries()) labels.set(r.id, `payout:${i + 1}`);
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return "<time>";
    if (typeof v === "string") return TS.test(v) ? "<time>" : v.replace(UUID, (u) => labels.get(u.toLowerCase()) ?? labels.get(u) ?? "<id>");
    // Lists the engine orders by UUID come out in a different order in every database: compare them as sets.
    if (Array.isArray(v)) return v.map(norm).sort((a, b) => (a && typeof a === "object" ? (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0) : 0));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !["created_at", "updated_at", "computed_at", "at", "recorded_at", "locked_at", "approved_at", "paid_at", "submitted_at", "release_on", "paid_on", "inputs_hash", "result_hash", "inputsHash", "resultHash"].includes(k)).map(([k, x]) => [k, norm(x)]));
    return v;
  };
  // Every stored run reproduces its own stored hashes (the hashes themselves contain this database's UUIDs).
  const { calculateCategoryA } = await import("@/lib/incentives/category-a/engine");
  const { inputsHash, resultHash } = await import("@/lib/incentives/category-a/hash");
  for (const r of await q1<{ inputs: never; inputs_hash: string; result_hash: string }>(`select inputs, inputs_hash, result_hash from incentive_calc_runs`)) {
    if (inputsHash(r.inputs) !== r.inputs_hash || resultHash(calculateCategoryA(r.inputs)) !== r.result_hash) throw new Error("A stored Category A run doesn't reproduce its hashes.");
  }
  const sorted = (rows: Record<string, unknown>[]) => rows.map(norm).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  const table = async (t: string) => sorted(await q1(`select * from ${t}`));
  const snapshot = {
    steps: norm(steps),
    runs: await table("incentive_calc_runs"),
    periods: await table("incentive_calc_periods"),
    results: await table("incentive_calc_results"),
    orderCredits: await table("incentive_calc_order_credits"),
    receiptCredits: await table("incentive_calc_receipt_credits"),
    adjustments: await table("incentive_calc_adjustments"),
    approvals: await table("incentive_calc_approvals"),
    payouts: await table("incentive_calc_payouts"),
    payoutLines: await table("incentive_calc_payout_lines"),
    audit: sorted(await q1(`select action, entity_type, entity_id, detail from incentive_audit`)),
  };
  await pg.close();
  return snapshot;
}

if (process.env.GOLDEN_WRITE === "1") {
  const snap = await flow(BASE);
  if (!existsSync(dirname(FILE))) mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(snap, null, 1)}\n`);
}

describe("Category A golden master — services, approval and payout", () => {
  const golden = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
  afterAll(() => {
    h.db = null;
  });
  it("the snapshot holds the April ₹925.00 month, approved twice and paid, with the later refund carried", () => {
    const results = golden.results as { payable_paise: string | number }[];
    expect(results.map((r) => String(r.payable_paise))).toContain("92500");
    expect((golden.payoutLines as { amount_paise: string | number }[]).map((l) => String(l.amount_paise))).toEqual(["92500"]);
    expect((golden.adjustments as { kind: string; amount_paise: string | number }[]).map((a) => [a.kind, String(a.amount_paise)])).toEqual([["recalc-difference", "-16667"]]);
  });
  for (const [name, migrations] of VARIANTS) {
    it(`is reproduced exactly on ${name}`, async () => {
      const now = await flow(migrations);
      // The flow releases and pays on TODAY's date (the services' own default), so the audit trail's release and
      // payment dates follow the calendar; they are ignored on both sides. Everything else must be identical.
      const undated = (v: unknown): unknown => (Array.isArray(v) ? v.map(undated) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== "paidOn" && k !== "releaseOn").map(([k, x]) => [k, undated(x)])) : v);
      for (const k of Object.keys(golden)) expect(undated(now[k as keyof typeof now]), k).toEqual(undated(golden[k]));
    }, 240_000);
  }
});
