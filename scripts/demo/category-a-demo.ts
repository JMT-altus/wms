/**
 * DEMO ONLY — builds an isolated, local Category A demonstration database. NEVER production.
 *
 *   DATABASE_URL=postgres://postgres@localhost:55432/wms_demo_category_a \
 *   DEMO_ADMIN_EMAIL=<the email you sign in with> \
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=demo-placeholder-not-a-key \
 *   node --conditions=react-server --import tsx scripts/demo/category-a-demo.ts
 *
 * Refuses unless DATABASE_URL is a server on localhost, the database name starts with "wms_demo", and it is not
 * production's fingerprint. It creates the database (if missing), builds the schema (db/schema.ts for the existing
 * tables, migrations 0131–0133's own SQL for Incentive Rules and Category A), and seeds ONLY data reconstructed from
 * the verified test fixtures (tests/fixtures/category-a.ts — April example 2, ₹925.00), through the app's OWN services
 * (maker-checker publishing, calculation, lock, submission, first approval). Every record is labelled DEMO.
 * The demo admin is also the demo salesperson, so one sign-in shows both the admin screens and My Incentives.
 * It leaves April awaiting its SECOND approval, for you to approve and record the payout live.
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
const APR = "2026-04-01";

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
  // Incentive Rules + Category A come from their migrations' own SQL (with every trigger and check), not from Drizzle.
  const fromMigrations = /^incentive_(programs|config_|calc_)/;
  const objects = Object.fromEntries(
    Object.entries(schema).filter(([, v]) => isPgEnum(v) || (is(v, PgTable) && !fromMigrations.test(getTableName(v)))),
  );
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(objects));
  // One transaction: a failure leaves nothing half-built.
  await sql.begin(async (tx) => {
    await tx.unsafe("create extension if not exists pg_trgm");
    for (const s of statements) {
      try {
        await tx.unsafe(s);
      } catch (e) {
        throw new Error(`schema statement failed (${(e as Error).message}): ${s.slice(0, 300)}`);
      }
    }
    for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"]) await tx.unsafe(readFileSync(resolve(ROOT, "db/migrations", f), "utf8"));
  });
  console.log(`schema: built (${statements.length} statements from db/schema.ts + migrations 0131–0133)`);
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
  // The app's own services, bound to DATABASE_URL (the demo database) through lib/db.
  const rules = await import("@/lib/queries/incentive-rules");
  const calc = await import("@/lib/queries/incentive-calc");
  const { aprilConfig, EXAMPLE_2, L } = await import("../../tests/fixtures/category-a");
  const { PERMISSION_FIELDS } = await import("@/db/enums");

  const emp = async (name: string, email: string, isAdmin: boolean) =>
    ((await sql`insert into employees (name, email, role, is_admin, is_active) values (${name}, ${email}, 'both', ${isAdmin}, true) returning id`) as unknown as [{ id: string }])[0].id;
  const admin = await emp("Demo Admin & Salesperson", ADMIN_EMAIL, true);
  const staff: Record<string, string> = {};
  for (const [k, name] of [["author", "Demo Rules Author"], ["checker", "Demo Rules Checker"], ["runner", "Demo Calculation Runner"], ["submitter", "Demo Submitter"], ["approver1", "Demo Approver 1"]] as const)
    staff[k] = await emp(name, `${k}@demo.invalid`, true);
  // The demo admin holds every Incentive Rules / Calculation permission (in the DEMO database only).
  for (const f of PERMISSION_FIELDS.filter((x) => x.key.startsWith("incentive.")))
    await sql`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values (${f.key}, 'employee', ${admin}, true)`;
  const actor = (id: string, name: string) => ({ id, name });

  // A published Category A configuration: the verified test configuration (tests/fixtures/category-a.ts), covering
  // the demo salesperson, authored and approved by two different people, published from April 2026.
  const prog = await rules.createProgram(actor(staff.author!, "Demo Rules Author"), { code: "DEMO", name: "DEMO — Sales team (demo data)", description: "Demonstration programme: April 2026 example 2 from the verified test fixtures. Not real data." });
  if (!prog.ok) throw new Error(prog.error);
  const config = aprilConfig();
  config.eligibility = [{ subjectType: "employee", subjectId: admin, role: null, subjectLabel: "Demo Admin & Salesperson", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }];
  const d = await rules.createDraft(actor(staff.author!, "Demo Rules Author"), { programId: prog.programId, category: "A", startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(actor(staff.author!, "Demo Rules Author"), d.versionId, 1, config, "DEMO: the verified April test configuration");
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(actor(staff.author!, "Demo Rules Author"), d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(actor(staff.checker!, "Demo Rules Checker"), d.versionId, sub.rowVersion, "DEMO approval");
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(actor(staff.checker!, "Demo Rules Checker"), d.versionId, ap.rowVersion, APR, { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);

  // Forms documents for April example 2 (tests/fixtures/category-a.ts EXAMPLE_2): 12 Sales Orders of ₹10 L, one
  // invoice each due on its date, and the receipts at the fixture's fractions and day offsets.
  const [{ id: customer }] = (await sql`insert into customer_masters (name, code, sales_rep_id) values ('DEMO Customer (demo data)', 'DEMO-C1', ${admin}) returning id`) as unknown as [{ id: string }];
  const [{ id: batch }] = (await sql`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 'DEMO-category-a-april-2026.xlsx', 'demo') returning id`) as unknown as [{ id: string }];
  const doc = async (type: string, no: string, date: string, total: number, ref: string | null, due: string | null, lines: unknown[] = []) =>
    ((await sql`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, narration, import_batch_id, source_row)
      values (${`${type}|${no}`}, ${type}, ${no}, ${no.toLowerCase()}, ${date}, '2026-27', 'DEMO Customer (demo data)', 'demo customer (demo data)', ${customer}, ${total}, ${total}, ${ref}, ${due}, ${sql.json(lines as never)}, 'DEMO data — not a real transaction', ${batch}, 1) returning id`) as unknown as [{ id: string }])[0].id;
  for (const [i, pays] of EXAMPLE_2.entries()) {
    const n = i + 1;
    const order = await doc("sales-orders", `DEMO-SO ${n}`, "2026-04-05", L(10), null, null, [{ item: "DEMO item", quantity: 1, ratePaise: L(10), amountPaise: L(10) }]);
    const inv = await doc("sales-invoices", `DEMO-INV ${n}`, "2026-04-05", L(10), order, "2026-04-05");
    for (const [k, [fraction, days]] of pays.entries()) await doc("customer-receipts", `DEMO-RC ${n}.${k + 1}`, new Date(Date.parse("2026-04-05T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10), Math.round(L(10) * fraction), inv, null);
  }

  // Calculate April as of 30 Sep 2026 (the fixture's date), lock, submit, first approval — through the services.
  const c = await calc.calculate(actor(staff.runner!, "Demo Calculation Runner"), prog.programId, APR, "2026-09-30");
  if (!c.ok || c.status !== "computed") throw new Error(`calculation: ${JSON.stringify(c)}`);
  const rv = async () => ((await sql`select row_version from incentive_calc_periods where month = ${APR}`) as unknown as [{ row_version: number }])[0].row_version;
  const l = await calc.setLocked(actor(staff.runner!, "Demo Calculation Runner"), prog.programId, APR, true, await rv());
  if (!l.ok) throw new Error(l.error);
  const su = await calc.submitMonth(actor(staff.submitter!, "Demo Submitter"), prog.programId, APR, await rv());
  if (!su.ok) throw new Error(su.error);
  const a1 = await calc.decideMonth(actor(staff.approver1!, "Demo Approver 1"), prog.programId, APR, await rv(), "approve", "DEMO: first approval");
  if (!a1.ok) throw new Error(a1.error);

  const [r] = (await sql`select r.payable_paise::int p from incentive_calc_results r join incentive_calc_periods p on p.current_run_id = r.run_id`) as unknown as [{ p: number }];
  console.log(`seed: DEMO programme published from ${APR}; 12 orders, 12 invoices, ${EXAMPLE_2.flat().length} receipts; April calculated (payable ₹${(r.p / 100).toFixed(2)}), locked, submitted, approval 1 of 2 done.`);
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
