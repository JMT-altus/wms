import { checkRole, ledgerRows, lit, sha256, tableCount, type Exec } from "../incentive-0136/core";

/**
 * Migration 0142 (Category A: acknowledgments of held items, two-person negative balances, database safeguards) — the
 * SAFETY LOGIC of its preflight, apply, rollback and verification runners, apart from any connection so it is proven on
 * an in-memory PGlite database (tests/integration/incentive-0142-runners.db.test.ts). It reuses the reviewed 0136
 * primitives (canonical-LF pinning, the production fingerprint, role / ledger / table checks).
 *
 * 0142 adds two tables (incentive_calc_a_reviews, incentive_calc_negative_decisions), their functions, and triggers on
 * three EXISTING tables (incentive_calc_adjustments, incentive_calc_approvals, incentive_calc_payouts). It changes no
 * existing column, constraint, row or function. So:
 *   · before: none of its objects exists; 0131–0133 are recorded in the ledger; nothing from 0142 on is;
 *   · during: every table's data (all of them) and the catalogue outside 0142's own objects are fingerprinted before and
 *     compared after; 0142's objects must be exactly the pinned listing; its new tables are empty;
 *   · rollback: refused while either new table holds a row (the rollback SQL refuses too); afterwards the database must be
 *     exactly as before (none of 0142's objects; the catalogue identical).
 * Every function throws on anything unexpected; the caller's transaction then rolls everything back.
 */
export { assertProduction, canonicalBytes, fingerprintOf, pinned, sha256, ledgerRows, lit, tableCount, checkRole, type Exec } from "../incentive-0136/core";
export { PRODUCTION_FINGERPRINT } from "../incentive-0136/core";

export const FILES = {
  migration: "0142_incentive_category_a_safeguards.sql",
  rollback: "0142_incentive_category_a_safeguards.rollback.sql",
} as const;
/** sha256 of the CANONICAL (LF) bytes. */
export const PINS = {
  migration: "e68e6c36e3bb03b2fe1bcb0df4d9c59f3c4e10eaf299f8c01589fb78127addc4",
  rollback: "60c6a8a83bbeba4f7367dd4d7dbc36413e91314715ba793539fefa28b64396c8",
} as const;

export interface Expect {
  /** Check the migration ledger (production: true). */
  ledger: boolean;
  /** Check the connecting role (production: true). */
  role: boolean;
}
export const PRODUCTION: Expect = { ledger: true, role: true };

export const NEW_TABLES = ["incentive_calc_a_reviews", "incentive_calc_negative_decisions"] as const;
export const NEW_FNS = ["incentive_calc_a_reviews_check", "incentive_calc_negative_decisions_check", "incentive_calc_a_negative_approved", "incentive_calc_a_approvals_check", "incentive_calc_a_payouts_check", "incentive_calc_a_payout_reconciled"] as const;
/** Triggers 0142 puts on tables that existed before it. */
export const NEW_TRIGGERS_ON_EXISTING = ["incentive_calc_adjustments:incentive_calc_a_negative_approved", "incentive_calc_approvals:incentive_calc_a_approvals_insert", "incentive_calc_payouts:incentive_calc_a_payouts_insert", "incentive_calc_payouts:incentive_calc_a_payout_reconciled"] as const;
/** The Category A files 0142 extends (they must be recorded before it). */
export const REQUIRED = ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"] as const;
/** sha256 of 0142's own objects' listing (listing0142), taken on PGlite with 0131–0133 + 0142. */
export const CANON_0142 = "a15df5ee191ec739494d53e678cc874fefc819dd0b2880a123c5e8d6cb734dbd";

const isNew = (name: string) => NEW_TABLES.some((t) => name === t || name.startsWith(`${t}_`));
const isNewTrigger = (table: string, name: string) => (NEW_TRIGGERS_ON_EXISTING as readonly string[]).includes(`${table}:${name}`);

/* ── reads ── */

/** Which of 0142's own objects exist. */
export async function present0142(x: Exec) {
  const tables = (await x.query<{ t: string }>(`select relname t from pg_class where relnamespace = 'public'::regnamespace and relname in (${lit(NEW_TABLES)}) order by 1`)).map((r) => r.t);
  const fns = (await x.query<{ f: string }>(`select proname f from pg_proc where pronamespace = 'public'::regnamespace and proname in (${lit(NEW_FNS)}) order by 1`)).map((r) => r.f);
  const trig = (await x.query<{ t: string; n: string }>(`select tgrelid::regclass::text t, tgname n from pg_trigger where not tgisinternal and tgname in (${lit(NEW_TRIGGERS_ON_EXISTING.map((s) => s.split(":")[1]!))}) order by 1, 2`)).map((r) => `${r.t}:${r.n}`);
  return { tables, fns, triggers: trig };
}
const none = (p: Awaited<ReturnType<typeof present0142>>) => !p.tables.length && !p.fns.length && !p.triggers.length;

/** A position-numbered, collation-free listing of 0142's own objects (columns, constraints, indexes, triggers, functions). */
export async function listing0142(x: Exec): Promise<string> {
  const sortJs = <T>(rows: T[], key: (r: T) => string) => rows.map((r) => [key(r), r] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, r]) => r);
  const cols = await x.query<{ t: string; c: string }>(`select table_name t, column_name c, data_type, is_nullable, coalesce(column_default, '') d, ordinal_position::int p from information_schema.columns where table_schema = 'public' and table_name in (${lit(NEW_TABLES)})`);
  const cons = await x.query<{ conname: string }>(`select conrelid::regclass::text t, conname, contype::text, pg_get_constraintdef(oid) def from pg_constraint where conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname in (${lit(NEW_TABLES)}))`);
  const idx = await x.query<{ indexname: string }>(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in (${lit(NEW_TABLES)})`);
  const trig = (await x.query<{ t: string; tgname: string }>(`select tgrelid::regclass::text t, tgname, tgenabled::text e, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)`)).filter((r) => isNew(r.t) || isNewTrigger(r.t, r.tgname));
  const fns = await x.query<{ proname: string }>(`select proname, pg_get_function_identity_arguments(oid) args, md5(prosrc) src, prosecdef secdef from pg_proc where pronamespace = 'public'::regnamespace and proname in (${lit(NEW_FNS)})`);
  const sec = await x.query<{ relname: string }>(`select c.relname, c.relrowsecurity rls, c.relforcerowsecurity f, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (${lit(NEW_TABLES)})`);
  return JSON.stringify({
    cols: sortJs(cols, (r) => `${r.t}|${String((r as unknown as { p: number }).p).padStart(3, "0")}`),
    cons: sortJs(cons, (r) => r.conname),
    idx: sortJs(idx, (r) => r.indexname),
    trig: sortJs(trig, (r) => `${r.t}|${r.tgname}`),
    fns: sortJs(fns, (r) => r.proname),
    sec: sortJs(sec, (r) => r.relname),
  });
}

/** Every table's data (count and content hash), except 0142's own tables. */
export async function dataFingerprints(x: Exec): Promise<Record<string, string>> {
  const tables = (await x.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by relname`)).map((r) => r.relname).filter((t) => !isNew(t));
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [r] = await x.query<{ n: string; h: string }>(`select count(*)::text n, coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') h from public."${t.replace(/"/g, '""')}" t`);
    out[t] = `${r!.n}:${r!.h}`;
  }
  return out;
}

/** The catalogue except 0142's own objects (tables, functions and the triggers it adds to existing tables). */
export async function catalogue(x: Exec): Promise<string> {
  const rels = (await x.query<{ relname: string }>(`select c.relname, c.relkind::text k, c.relrowsecurity rls, c.relforcerowsecurity force, coalesce(c.relacl::text, '') acl from pg_class c where c.relnamespace = 'public'::regnamespace order by c.relname`)).filter((r) => !isNew(r.relname));
  const cols = (await x.query<{ table_name: string }>(`select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') d from information_schema.columns where table_schema = 'public' order by 1, 2`)).filter((r) => !isNew(r.table_name));
  // A constraint trigger 0142 adds to an existing table is listed here too (contype t): it is 0142's own.
  const cons = (await x.query<{ t: string; conname: string; contype: string }>(`select conrelid::regclass::text t, conname, contype::text, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)).filter((r) => !isNew(r.t) && !(r.contype === "t" && isNewTrigger(r.t, r.conname)));
  const idx = (await x.query<{ tablename: string }>(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`)).filter((r) => !isNew(r.tablename));
  const trig = (await x.query<{ t: string; tgname: string }>(`select tgrelid::regclass::text t, tgname, tgenabled::text e, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) order by 1, 2`)).filter((r) => !isNew(r.t) && !isNewTrigger(r.t, r.tgname));
  const fns = (await x.query<{ proname: string }>(`select proname, pg_get_function_identity_arguments(oid) args, md5(prosrc) src, prosecdef secdef, coalesce(proacl::text, '') acl from pg_proc where pronamespace = 'public'::regnamespace order by 1, 2`)).filter((r) => !(NEW_FNS as readonly string[]).includes(r.proname));
  const pol = await x.query(`select tablename, policyname, cmd, roles::text, coalesce(qual, '') q, coalesce(with_check, '') w from pg_policies where schemaname = 'public' order by 1, 2`);
  return JSON.stringify({ rels, cols, cons, idx, trig, fns, pol });
}

async function security(x: Exec) {
  for (const table of NEW_TABLES) {
    const [s] = await x.query<{ rls: boolean; f: boolean; pol: number; rest: boolean | null }>(
      `select c.relrowsecurity rls, c.relforcerowsecurity f, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol,
         (select bool_or(has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) from pg_roles r where r.rolname in ('anon', 'authenticated')) rest
       from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = $1`,
      [table],
    );
    if (!s || !s.rls || s.f || s.pol !== 0 || s.rest) throw new Error(`security unexpected on ${table}: ${JSON.stringify(s ?? null)}`);
  }
}

/** Rows only 0142 allows — why a rollback must refuse (null when there are none). Mirrors the rollback SQL's refusal. */
export async function data0142(x: Exec): Promise<string | null> {
  const p = await present0142(x);
  const out: string[] = [];
  for (const t of p.tables) {
    const [r] = await x.query<{ n: number }>(`select count(*)::int n from public."${t}"`);
    if (r!.n) out.push(`${r!.n} row(s) in ${t}`);
  }
  return out.length ? out.join(", ") : null;
}

/** Every 0142 object exactly as pinned, with security; its tables empty when `empty` is asked. */
export async function assert0142(x: Exec, opts: { empty: boolean } = { empty: false }) {
  const p = await present0142(x);
  if (p.tables.length !== NEW_TABLES.length || p.fns.length !== NEW_FNS.length || p.triggers.length !== NEW_TRIGGERS_ON_EXISTING.length) throw new Error(`0142's objects incomplete: ${JSON.stringify(p)}`);
  const canon = sha256(await listing0142(x));
  if (canon !== CANON_0142) throw new Error(`0142's objects differ from the pinned listing (sha256 ${canon})`);
  await security(x);
  const unvalidated = await x.query<{ conname: string }>(`select conname from pg_constraint where conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname in (${lit(NEW_TABLES)})) and not convalidated`);
  if (unvalidated.length) throw new Error(`not validated: ${unvalidated.map((r) => r.conname).join(", ")}`);
  if (opts.empty) {
    const why = await data0142(x);
    if (why) throw new Error(`right after 0142: ${why}`);
  }
}

/** Taken FIRST in a commit transaction: Category A's approval, payout and adjustment writes wait. */
export async function lockFor(x: Exec) {
  await x.exec(`LOCK TABLE public."incentive_calc_periods", public."incentive_calc_approvals", public."incentive_calc_payouts", public."incentive_calc_payout_lines", public."incentive_calc_adjustments" IN EXCLUSIVE MODE`);
}
const xid = async (x: Exec) => (await x.query<{ id: string }>(`select txid_current()::text id`))[0]!.id;

/* ── preflight / apply ── */
export async function preApply(x: Exec, e: Expect) {
  if (e.role) await checkRole(x);
  let ledger: string[] = [];
  if (e.ledger) {
    ledger = await ledgerRows(x);
    if (new Set(ledger).size !== ledger.length) throw new Error("the ledger has duplicate rows");
    const missing = REQUIRED.filter((f) => !ledger.includes(f));
    if (missing.length) throw new Error(`0142 needs ${missing.join(", ")} recorded first`);
    if (ledger.some((f) => f >= "0142")) throw new Error("0142 (or a later file) is already recorded in the ledger");
  }
  const t = await tableCount(x);
  if (t.rls !== t.n) throw new Error(`${t.n - t.rls} public table(s) without RLS`);
  const p = await present0142(x);
  if (!none(p)) throw new Error(`0142's objects already (partly) exist — the state is ambiguous: ${JSON.stringify(p)}`);
  for (const need of ["tally_documents", "incentive_calc_periods", "incentive_calc_runs", "incentive_calc_results", "incentive_calc_adjustments", "incentive_calc_approvals", "incentive_calc_payouts", "incentive_calc_payout_lines", "incentive_calc_attributions", "incentive_calc_rep_history", "incentive_calc_receipt_events"]) {
    const [r] = await x.query<{ ok: boolean }>(`select to_regclass($1) is not null ok`, [`public.${need}`]);
    if (!r?.ok) throw new Error(`${need} is missing: 0131–0133 must be applied first`);
  }
  const [g] = await x.query<{ ok: boolean }>(`select exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'incentive_calc_input_guard') and exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'incentive_calc_append_only') ok`);
  if (!g?.ok) throw new Error("0133's input guard or 0132's append-only guard is missing");
  return { ledger, tables: t };
}

export async function applyIn(x: Exec, migration: string, e: Expect) {
  await lockFor(x);
  const pre = await preApply(x, e);
  const dataBefore = await dataFingerprints(x);
  const catBefore = await catalogue(x);
  const id = await xid(x);
  await x.exec(migration);
  if ((await xid(x)) !== id) throw new Error("the migration text ended the transaction (COMMIT / ROLLBACK inside it)");
  if (e.ledger) await x.query(`insert into public.__schema_applied (filename) values ($1)`, [FILES.migration]);
  const dataAfter = await dataFingerprints(x);
  const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((k) => dataBefore[k] !== dataAfter[k] && !(e.ledger && k === "__schema_applied"));
  if (changed.length) throw new Error(`existing data changed in: ${changed.join(", ")}`);
  if ((await catalogue(x)) !== catBefore) throw new Error("an object outside 0142 changed");
  await assert0142(x, { empty: true });
  if (e.ledger) {
    const after = await ledgerRows(x);
    const added = after.filter((f) => !pre.ledger.includes(f));
    if (after.length !== pre.ledger.length + 1 || added.join() !== FILES.migration) throw new Error(`ledger change unexpected: ${after.length} rows (+${added.join(",")})`);
  }
  const t = await tableCount(x);
  if (t.n !== pre.tables.n + NEW_TABLES.length || t.rls !== t.n) throw new Error(`expected ${pre.tables.n + NEW_TABLES.length} tables all with RLS, found ${t.n} (${t.rls})`);
  return { tablesFingerprinted: Object.keys(dataBefore).length, tables: t.n };
}

/* ── rollback ── */
export async function preRollback(x: Exec, e: Expect) {
  if (e.role) await checkRole(x);
  let ledger: string[] = [];
  if (e.ledger) {
    ledger = await ledgerRows(x);
    if (ledger.filter((f) => f === FILES.migration).length !== 1) throw new Error("0142 isn't recorded (exactly once) in the ledger");
    if (ledger.some((f) => f > FILES.migration)) throw new Error("a later file is recorded after 0142: roll that back first");
  }
  await assert0142(x);
  const why = await data0142(x);
  if (why) throw new Error(`rollback refused: ${why} (they are history)`);
  return { ledger };
}

export async function rollbackIn(x: Exec, rollback: string, e: Expect) {
  await lockFor(x);
  const pre = await preRollback(x, e);
  const dataBefore = await dataFingerprints(x);
  const catBefore = await catalogue(x);
  const before = await tableCount(x);
  const id = await xid(x);
  await x.exec(rollback);
  if ((await xid(x)) !== id) throw new Error("the rollback text ended the transaction (COMMIT / ROLLBACK inside it)");
  if (e.ledger) await x.query(`delete from public.__schema_applied where filename = $1`, [FILES.migration]);
  if (!none(await present0142(x))) throw new Error(`0142's objects remain: ${JSON.stringify(await present0142(x))}`);
  const dataAfter = await dataFingerprints(x);
  const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((k) => dataBefore[k] !== dataAfter[k] && !(e.ledger && k === "__schema_applied"));
  if (changed.length) throw new Error(`existing data changed in: ${changed.join(", ")}`);
  if ((await catalogue(x)) !== catBefore) throw new Error("an object outside 0142 changed during the rollback");
  const t = await tableCount(x);
  if (t.n !== before.n - NEW_TABLES.length) throw new Error(`expected ${before.n - NEW_TABLES.length} tables after the rollback, found ${t.n}`);
  if (e.ledger) {
    const after = await ledgerRows(x);
    if (after.length !== pre.ledger.length - 1 || after.includes(FILES.migration)) throw new Error("ledger change unexpected after the rollback");
  }
  return { tables: t.n };
}

/* ── verification (read only) ── */
export async function verifyApplied(x: Exec, e: Expect): Promise<{ check: string; ok: boolean }[]> {
  const out: { check: string; ok: boolean }[] = [];
  const add = async (check: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      out.push({ check, ok: true });
    } catch (err) {
      out.push({ check: `${check}: ${(err as Error).message}`, ok: false });
    }
  };
  if (e.role) await add("role", () => checkRole(x));
  if (e.ledger)
    await add("ledger: 0142 recorded once", async () => {
      const l = await ledgerRows(x);
      if (l.filter((f) => f === FILES.migration).length !== 1) throw new Error("not recorded exactly once");
    });
  await add("0142's objects exactly as pinned, with RLS and no REST access", () => assert0142(x));
  await add("every public table has RLS", async () => {
    const t = await tableCount(x);
    if (t.rls !== t.n) throw new Error(`${t.n - t.rls} without RLS`);
  });
  await add("rollback still possible (no acknowledgment or negative-balance decision yet)", async () => {
    const why = await data0142(x);
    if (why) throw new Error(why);
  });
  return out;
}

export async function verifyRolledBack(x: Exec, e: Expect): Promise<{ check: string; ok: boolean }[]> {
  const out: { check: string; ok: boolean }[] = [];
  const p = await present0142(x);
  out.push({ check: `none of 0142's objects remains${none(p) ? "" : `: ${JSON.stringify(p)}`}`, ok: none(p) });
  if (e.ledger) {
    const l = await ledgerRows(x);
    out.push({ check: "0142 not in the ledger", ok: !l.includes(FILES.migration) });
  }
  return out;
}
