/**
 * DEMO ONLY — builds an isolated, local Category B demonstration database. NEVER production.
 *
 *   DATABASE_URL=postgres://postgres@localhost:55432/wms_demo_category_b \
 *   DEMO_ADMIN_EMAIL=<the email you sign in with> \
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=demo-placeholder-not-a-key \
 *   node --conditions=react-server --import tsx scripts/demo/category-b-demo.ts
 *
 * Refuses unless DATABASE_URL is a server on localhost, the database name starts with "wms_demo", and it is not
 * production's fingerprint. It creates the database (if missing), builds the schema (db/schema.ts for the existing
 * tables, migrations 0131–0134's own SQL for Incentive Rules and Categories A and B), and seeds SYNTHETIC data only —
 * every amount, rate and limit is a labelled DEMO/TEST value, not company data — through the app's OWN services
 * (maker-checker publishing, calculation, manual decision, lock, submission, approvals, payout, recovery).
 *
 * What it shows (Category B, TEST rate 1%, TEST per-order limit ₹1,500, TEST monthly limit ₹2,500, minimum ₹1,00,000):
 *   April 2026 — qualifying (new product and brand), not qualifying (nothing new; a new customer; below the minimum;
 *     a credit note before payout), needs review (an unmatched item) decided by hand by the demo qualifier, the
 *     per-order limit before decay, a late receipt at 50%, a part-paid invoice (earned, not payable), the monthly
 *     limit binding (₹4,950 earned → ₹2,500), an invoice with no Sales Order (review) — calculated, locked, submitted, approved twice and PAID; then a
 *     credit note after payout, recovered in November (the paid month unchanged).
 *   May 2026 — one qualifying order, calculated, locked, submitted and approved once: the demo admin (also the demo
 *     salesperson, so My Incentives shows their own Category B) gives the second approval and records the payout live.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const URL_ = process.env.DATABASE_URL ?? "";
const ADMIN_EMAIL = (process.env.DEMO_ADMIN_EMAIL ?? "").trim().toLowerCase();
const die = (m: string): never => {
  console.error(`REFUSED: ${m}`);
  process.exit(1);
};
if (!URL_) die("set DATABASE_URL to the local demo database");
const u = new URL(URL_);
const dbName = u.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) die("the demo database must be on localhost");
if (!/^wms_demo[a-z0-9_]*$/.test(dbName)) die('the demo database name must start with "wms_demo"');
if (createHash("sha256").update(`${decodeURIComponent(u.username)}@${u.hostname}:${u.port}${u.pathname}`).digest("hex").slice(0, 10) === "ed679a28f0") die("that is production");
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ADMIN_EMAIL)) die("set DEMO_ADMIN_EMAIL to the email you sign in with");

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql"];
const RS = (r: number) => Math.round(r * 100);

async function createDatabase() {
  const adminUrl = new URL(URL_);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  const [exists] = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists) await admin.unsafe(`create database ${dbName}`);
  await admin.end();
  console.log(`demo database ${dbName}: ${exists ? "exists" : "created"}`);
}

async function buildSchema(sql: ReturnType<typeof postgres>) {
  const [{ n }] = (await sql`select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`) as unknown as [{ n: number }];
  if (n > 0) {
    console.log(`schema: already built (${n} tables)`);
    return;
  }
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const { isPgEnum, PgTable } = await import("drizzle-orm/pg-core");
  const { getTableName, is } = await import("drizzle-orm");
  const schema = await import("@/db/schema");
  // Incentive Rules and the calculation tables come from their migrations' own SQL (every trigger and check).
  const fromMigrations = /^incentive_(programs|config_|calc_)/;
  const objects = Object.fromEntries(Object.entries(schema).filter(([, v]) => isPgEnum(v) || (is(v, PgTable) && !fromMigrations.test(getTableName(v)))));
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(objects));
  await sql.begin(async (tx) => {
    await tx.unsafe("create extension if not exists pg_trgm");
    for (const s of statements) {
      try {
        await tx.unsafe(s);
      } catch (e) {
        throw new Error(`schema statement failed (${(e as Error).message}): ${s.slice(0, 300)}`);
      }
    }
    for (const f of MIGRATIONS) await tx.unsafe(readFileSync(resolve(ROOT, "db/migrations", f), "utf8"));
  });
  console.log(`schema: built (${statements.length} statements from db/schema.ts + migrations 0131–0134)`);
}

async function main() {
  await createDatabase();
  const sql = postgres(URL_, { max: 2, onnotice: () => {} });
  await buildSchema(sql);
  const [{ n: programs }] = (await sql`select count(*)::int n from incentive_programs`) as unknown as [{ n: number }];
  if (programs > 0) {
    console.log("seed: already seeded (a programme exists) — nothing changed");
    await sql.end();
    return;
  }
  const rules = await import("@/lib/queries/incentive-rules");
  const calc = await import("@/lib/queries/incentive-calc");
  const qualify = await import("@/lib/queries/incentive-b-qualify");
  const { bConfig } = await import("../../tests/fixtures/category-b");
  const { PERMISSION_FIELDS } = await import("@/db/enums");

  const emp = async (name: string, email: string, isAdmin: boolean) => ((await sql`insert into employees (name, email, role, is_admin, is_active) values (${name}, ${email}, 'both', ${isAdmin}, true) returning id`) as unknown as [{ id: string }])[0].id;
  const admin = await emp("Demo Admin & Salesperson", ADMIN_EMAIL, true);
  const staff: Record<string, string> = {};
  for (const [k, name] of [["author", "Demo Rules Author"], ["checker", "Demo Rules Checker"], ["runner", "Demo Calculation Runner"], ["submitter", "Demo Submitter"], ["qualifier", "Demo Qualifier"], ["approver1", "Demo Approver 1"], ["approver2", "Demo Approver 2"], ["payer", "Demo Payer"]] as const)
    staff[k] = await emp(name, `${k}@demo.invalid`, true);
  for (const f of PERMISSION_FIELDS.filter((x) => x.key.startsWith("incentive."))) await sql`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values (${f.key}, 'employee', ${admin}, true)`;
  const as = (k: string) => ({ id: staff[k]!, name: k === "qualifier" ? "Demo Qualifier" : `Demo ${k}` });

  // A published Category B configuration — TEST values, labelled: rate 1%, per-order ₹1,500, monthly ₹2,500.
  const prog = await rules.createProgram(as("author"), { code: "DEMO", name: "DEMO — Sales team (demo data)", description: "Demonstration programme for Category B. Synthetic data; every amount and limit is a TEST value." });
  if (!prog.ok) throw new Error(prog.error);
  const config = bConfig({ "caps.perEmployeeCategoryMonth": RS(2_500), "payout.approvalSteps": 2, "payout.release": "afterApproval" });
  config.eligibility = [{ subjectType: "employee", subjectId: admin, role: null, subjectLabel: "Demo Admin & Salesperson", mode: "include", effectiveFrom: "2024-01-01", effectiveTo: null }];
  const d = await rules.createDraft(as("author"), { programId: prog.programId, category: "B", startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(as("author"), d.versionId, 1, config, "DEMO: TEST rate 1%, per-order ₹1,500, monthly ₹2,500 — not business values");
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(as("author"), d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(as("checker"), d.versionId, sub.rowVersion, "DEMO approval");
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(as("checker"), d.versionId, ap.rowVersion, "2026-04-01", { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);

  // Masters and Forms documents (all labelled DEMO).
  const product = async (name: string, brand: string | null) => ((await sql`insert into products (name, brand, description) values (${`DEMO ${name}`}, ${brand}, 'DEMO product') returning id`) as unknown as [{ id: string }])[0].id;
  const P = { drive: await product("Drive", "Alpha"), motor: await product("Motor", "Beta"), gearbox: await product("Gearbox", "Alpha"), coupling: await product("Coupling", null), controller: await product("Controller", "Gamma"), panel: await product("Panel", "Delta"), sensor: await product("Sensor", null) };
  const customer = async (name: string, code: string) => ((await sql`insert into customer_masters (name, code, sales_rep_id, credit_period_days) values (${name}, ${code}, ${admin}, 30) returning id`) as unknown as [{ id: string }])[0].id;
  const C1 = await customer("DEMO Existing Customer (demo data)", "DEMO-B1");
  const C2 = await customer("DEMO New Customer (demo data)", "DEMO-B2");
  // A second existing customer, for the order with an unmatched item: once an unmatched line is in a customer's
  // history, every later order of that customer within the look back needs review (it might be the "new" product).
  const C3 = await customer("DEMO Second Existing Customer (demo data)", "DEMO-B3");
  const [{ id: batch }] = (await sql`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'DEMO-category-b-2026.xlsx', 'demo') returning id`) as unknown as [{ id: string }];
  const docs: Record<string, string> = {};
  const doc = async (type: string, no: string, date: string, total: number, o: { taxable?: number; ref?: string; due?: string; lines?: unknown[]; cust?: string | null } = {}) => {
    const cust = o.cust === undefined ? C1 : o.cust;
    const party = cust === C2 ? "DEMO New Customer (demo data)" : cust === C3 ? "DEMO Second Existing Customer (demo data)" : "DEMO Existing Customer (demo data)";
    const [{ id }] = (await sql`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, narration, import_batch_id, source_row)
      values (${`${type}|${no}`}, ${type}, ${no}, ${no.toLowerCase()}, ${date}, '2026-27', ${party}, ${party.toLowerCase()}, ${cust}, ${total}, ${o.taxable ?? total}, ${o.ref ?? null}, ${o.due ?? null}, ${sql.json((o.lines ?? []) as never)}, 'DEMO data — not a real transaction', ${batch}, 1) returning id`) as unknown as [{ id: string }];
    docs[no] = id;
    return id;
  };
  const line = (p: string | null, item: string, amt: number) => ({ item, quantity: 1, ratePaise: amt, amountPaise: amt, productId: p });
  const gst = (r: number) => RS(r * 1.18);
  const due = (d0: string) => new Date(Date.parse(`${d0}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const sale = async (n: string, orderDate: string, lines: unknown[], invDate: string, taxable: number, cust?: string) => {
    await doc("sales-orders", `DEMO-SO ${n}`, orderDate, gst(taxable), { taxable: RS(taxable), lines, cust });
    return doc("sales-invoices", `DEMO-INV ${n}`, invDate, gst(taxable), { taxable: RS(taxable), ref: docs[`DEMO-SO ${n}`], due: due(invDate), cust });
  };
  await doc("sales-orders", "DEMO-SO H1", "2025-06-10", gst(50_000), { taxable: RS(50_000), lines: [line(P.drive, "DEMO Drive", RS(50_000))] });
  await doc("sales-orders", "DEMO-SO H2", "2025-09-12", gst(40_000), { taxable: RS(40_000), lines: [line(P.drive, "DEMO Drive", RS(40_000))], cust: C3 });
  // April 2026.
  const i1 = await sale("B-1", "2026-04-02", [line(P.motor, "DEMO Motor", RS(1_20_000))], "2026-04-05", 1_20_000); // qualifies: ₹1,200
  await doc("customer-receipts", "DEMO-RC B-1", "2026-05-01", gst(1_20_000), { ref: i1 });
  const i2 = await sale("B-2", "2026-04-03", [line(P.drive, "DEMO Drive", RS(1_50_000))], "2026-04-06", 1_50_000); // nothing new
  await doc("customer-receipts", "DEMO-RC B-2", "2026-05-02", gst(1_50_000), { ref: i2 });
  const i3 = await sale("B-3", "2026-04-04", [line(null, "DEMO unmatched spare", RS(2_00_000))], "2026-04-08", 2_00_000, C3); // review → decided by hand
  await doc("customer-receipts", "DEMO-RC B-3", "2026-07-07", gst(2_00_000), { ref: i3, cust: C3 }); // 60 days after due: 50%
  await sale("B-4", "2026-04-07", [line(P.motor, "DEMO Motor", RS(1_30_000))], "2026-04-09", 1_30_000, C2); // a new customer
  await sale("B-5", "2026-04-10", [line(P.gearbox, "DEMO Gearbox", RS(90_000))], "2026-04-12", 90_000); // below the minimum
  const i6 = await sale("B-6", "2026-04-11", [line(P.coupling, "DEMO Coupling", RS(1_10_000))], "2026-04-14", 1_10_000); // credit note before payout
  await doc("credit-notes", "DEMO-CN B-6", "2026-04-25", gst(20_000), { taxable: RS(20_000), ref: i6 });
  const i7 = await sale("B-7", "2026-04-15", [line(P.controller, "DEMO Controller", RS(1_50_000))], "2026-04-18", 1_50_000); // part-paid: earned, not payable
  await doc("customer-receipts", "DEMO-RC B-7", "2026-05-10", gst(75_000), { ref: i7 });
  const i10 = await sale("B-10", "2026-04-16", [line(P.panel, "DEMO Panel", RS(1_50_000))], "2026-04-19", 1_50_000); // ₹1,500, on time: the monthly limit binds
  await doc("customer-receipts", "DEMO-RC B-10", "2026-05-15", gst(1_50_000), { ref: i10 });
  await doc("sales-invoices", "DEMO-INV B-9", "2026-04-20", gst(1_00_000), { taxable: RS(1_00_000), due: due("2026-04-20") }); // no Sales Order: review
  // May 2026: one qualifying order (a Sensor: a new product with no brand).
  const i8 = await sale("B-8", "2026-05-03", [line(P.sensor, "DEMO Sensor", RS(1_40_000))], "2026-05-06", 1_40_000);
  await doc("customer-receipts", "DEMO-RC B-8", "2026-06-01", gst(1_40_000), { ref: i8 });

  const B = "B" as const;
  const rv = async (month: string) => ((await sql`select row_version from incentive_calc_periods where category_code = 'B' and month = ${month}`) as unknown as [{ row_version: number }])[0].row_version;
  const must = <T extends { ok: boolean }>(r: T, what: string): T => {
    if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
    return r;
  };
  // April: calculate → review case decided by the demo qualifier → recalculate → lock → submit → two approvals → pay.
  must(await calc.calculate(as("runner"), prog.programId, "2026-04-01", "2026-07-31", B), "April calculation");
  must(await qualify.recordOverride(as("qualifier"), { orderId: docs["DEMO-SO B-3"]!, decision: "qualify", reason: "DEMO: the unmatched spare is a new product line for this customer (checked against the customer file)" }), "decision");
  must(await calc.calculate(as("runner"), prog.programId, "2026-04-01", "2026-07-31", B), "April recalculation");
  must(await calc.setLocked(as("runner"), prog.programId, "2026-04-01", true, await rv("2026-04-01"), B), "lock");
  must(await calc.submitMonth(as("submitter"), prog.programId, "2026-04-01", await rv("2026-04-01"), B), "submit");
  must(await calc.decideMonth(as("approver1"), prog.programId, "2026-04-01", await rv("2026-04-01"), "approve", "DEMO approval 1", undefined, B), "approve 1");
  must(await calc.decideMonth(as("approver2"), prog.programId, "2026-04-01", await rv("2026-04-01"), "approve", "DEMO approval 2", undefined, B), "approve 2");
  const [{ release, total }] = (await sql`select release_on::text release, (select sum(greatest(0, r.payable_paise))::int from incentive_calc_results r where r.run_id = p.current_run_id) total from incentive_calc_periods p where category_code = 'B' and month = '2026-04-01'`) as unknown as [{ release: string; total: number }];
  must(await calc.recordPayout(as("payer"), prog.programId, "2026-04-01", await rv("2026-04-01"), { reference: "DEMO-PAY-B-APR", paidOn: release, amountPaise: total, note: "DEMO payout record" }, release, B), "payout");
  // After payout: a credit note takes DEMO-INV B-1 below the minimum → recovered in the current (November) month.
  const today = calc.todayIST();
  await doc("credit-notes", "DEMO-CN B-1", today, gst(30_000), { taxable: RS(30_000), ref: i1 });
  const month = `${today.slice(0, 7)}-01`;
  must(await calc.calculate(as("runner"), prog.programId, month, today, B), "current month");
  must(await calc.calculate(as("runner"), prog.programId, "2026-04-01", today, B), "April recalculation after payout");
  // May: calculated, locked, submitted, first approval — the demo admin approves step 2 and pays live.
  must(await calc.calculate(as("runner"), prog.programId, "2026-05-01", "2026-06-30", B), "May calculation");
  must(await calc.setLocked(as("runner"), prog.programId, "2026-05-01", true, await rv("2026-05-01"), B), "May lock");
  must(await calc.submitMonth(as("submitter"), prog.programId, "2026-05-01", await rv("2026-05-01"), B), "May submit");
  must(await calc.decideMonth(as("approver1"), prog.programId, "2026-05-01", await rv("2026-05-01"), "approve", "DEMO approval 1", undefined, B), "May approve 1");

  const show = (await sql`select p.month::text m, p.status, r.earned_paise::int e, r.payable_paise::int pay from incentive_calc_periods p left join incentive_calc_results r on r.run_id = p.current_run_id where p.category_code = 'B' order by 1`) as unknown as { m: string; status: string; e: number | null; pay: number | null }[];
  const adj = (await sql`select to_month::text t, amount_paise::int a from incentive_calc_adjustments where category_code = 'B'`) as unknown as { t: string; a: number }[];
  console.log(`seed: DEMO Category B published from 2026-04 (TEST rate 1%, per-order ₹1,500, monthly ₹2,500).`);
  for (const r of show) console.log(`  ${r.m.slice(0, 7)} ${r.status}: earned ₹${((r.e ?? 0) / 100).toFixed(2)}, payable ₹${((r.pay ?? 0) / 100).toFixed(2)}`);
  for (const a of adj) console.log(`  recovery carried into ${a.t.slice(0, 7)}: ₹${(a.a / 100).toFixed(2)}`);
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
