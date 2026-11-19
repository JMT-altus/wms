import { createHash } from "node:crypto";

/**
 * Migration 0136 (Category C corrections) — the SAFETY LOGIC of its apply, rollback and verification runners, kept apart
 * from any connection so it can be proven on an in-memory PGlite database (tests/integration/incentive-0136-runners.db.test.ts).
 *
 * Every function takes an `Exec` (one transaction's query / exec) and THROWS on anything unexpected; the caller's
 * transaction then rolls everything back. Nothing here connects, reads .env files, or decides to commit.
 *   apply     preApply → fingerprint every existing table's data and the catalogue → 0136 → ledger row → the same
 *             fingerprints and catalogue unchanged → every new object exactly as pinned (empty) → counts.
 *   rollback  preRollback (0136 exactly as pinned and EMPTY, no 0136 data anywhere) → fingerprints and catalogue → the
 *             rollback SQL (its own refusal still runs: never bypassed) → ledger row removed → unchanged → 0135 restored
 *             exactly (function, settings list, entity check as the 0135 / 0134 files have them) → counts.
 * SQL lists are built only from the constants below (never from input); values are passed as parameters.
 */

export interface Exec {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
}

export const FILES = {
  migration: "0136_incentive_category_c_review.sql",
  rollback: "0136_incentive_category_c_review.rollback.sql",
  m0135: "0135_incentive_categories_c_g.sql",
  m0134: "0134_incentive_category_b.sql",
} as const;
/** The exact bytes approved for review. Any other bytes are refused. */
export const PINS = {
  migration: "069f173c003bc057e0b21577d13e8650c9298b417eb48a7ec99d8da8688052ea",
  rollback: "192c5a2d16c784d7b6d6dc12d94e40381320b1605d4b65cdf0ce5fa0cc99c929",
  /** As applied to production on 2026-11-18 (its function and settings list are what a rollback restores). */
  m0135: "42863df6b36007e5eee94a21bc58244f8f739ef3b1c1f3eb918f1ef8a6692718",
} as const;
export const PRODUCTION_FINGERPRINT = "ed679a28f0";

export interface Expect {
  /** The ledger (__schema_applied) row counts before / after 0136, or null where there is no ledger. */
  ledger: { before: number; after: number } | null;
  /** Public tables before / after 0136 (all with RLS). */
  tables: { before: number; after: number };
  /** Production's role and database (postgres, BYPASSRLS, database "postgres"). */
  role: boolean;
}
/** Production as last verified read-only after 0135 (2026-11-18): ledger 148, 163 public tables. */
export const PRODUCTION: Expect = { ledger: { before: 148, after: 149 }, tables: { before: 163, after: 166 }, role: true };

export const NEW_TABLES = ["incentive_calc_c_reviews", "incentive_calc_carry", "incentive_calc_period_voids"] as const;
export const NEW_FNS = ["incentive_calc_c_reviews_check", "incentive_calc_c_approvals_check", "incentive_calc_carry_check", "incentive_calc_period_voids_check"] as const;
export const REPLACED_FN = "incentive_config_settings_category_check";
export const CHANGED_CONSTRAINTS = ["incentive_config_settings_key_check", "incentive_calc_input_history_entity_check"] as const;
export const NEW_TRIGGER_ON_EXISTING = { table: "incentive_calc_approvals", name: "incentive_calc_c_approvals_insert" } as const;
export const NEW_KEYS = ["c.turnoverWindowMonths", "c.turnoverBasis", "payout.minimumPayable", "payout.belowMinimum", "payout.carryForwardExpiry", "payout.carryForwardExpiryMonths"] as const;
export const SHARED_WITH_C = ["collection.payableWhen", "adjust.creditNote", "adjust.salesReturn"] as const;
export const EXPECT_COLS: Record<(typeof NEW_TABLES)[number], string> = {
  incentive_calc_c_reviews: "id,document_id,case_kind,decision,target_id,reason,created_by_id,created_by_name,created_at,retired_at,retired_by_id,retired_reason",
  incentive_calc_carry: "id,program_id,category_code,employee_id,employee_name,month,kind,amount_paise,lot_id,period_id,run_id,reason,created_by_id,created_by_name,created_at",
  incentive_calc_period_voids: "id,period_id,run_id,carried_to_month,summary,reason,created_by_id,created_by_name,created_at",
};
/** Sorted in JavaScript (code-unit order), never by a database collation. */
export const EXPECT_FKS = [
  "incentive_calc_c_reviews>employees:n", "incentive_calc_c_reviews>employees:n", "incentive_calc_c_reviews>tally_documents:r",
  "incentive_calc_carry>employees:n", "incentive_calc_carry>employees:n", "incentive_calc_carry>incentive_calc_carry:r", "incentive_calc_carry>incentive_calc_periods:r", "incentive_calc_carry>incentive_calc_runs:r", "incentive_calc_carry>incentive_programs:r",
  "incentive_calc_period_voids>employees:n", "incentive_calc_period_voids>incentive_calc_periods:r", "incentive_calc_period_voids>incentive_calc_runs:r",
].sort();
export const EXPECT_TRIGGERS = [
  "incentive_calc_c_reviews:incentive_calc_c_reviews_guard", "incentive_calc_c_reviews:incentive_calc_c_reviews_insert",
  "incentive_calc_carry:incentive_calc_carry_insert", "incentive_calc_carry:incentive_calc_carry_no_change",
  "incentive_calc_period_voids:incentive_calc_period_voids_insert", "incentive_calc_period_voids:incentive_calc_period_voids_no_change",
].sort();
export const UNIQUES: Record<string, RegExp> = {
  incentive_calc_c_reviews_active_uq: /\(document_id, case_kind\) WHERE \(retired_at IS NULL\)$/,
  incentive_calc_carry_held_uq: /\(period_id, employee_id\) WHERE \(\(kind = 'held'::text\) AND \(employee_id IS NOT NULL\)\)$/,
  incentive_calc_carry_consume_uq: /\(lot_id, period_id, kind\) WHERE \(\(lot_id IS NOT NULL\) AND \(period_id IS NOT NULL\)\)$/,
  incentive_calc_period_voids_period_uq: /\(period_id\)$/,
};
export const ENTITY_0134 = "CHECK ((entity = ANY (ARRAY['attribution'::text, 'rep-history'::text, 'receipt-event'::text, 'b-override'::text])))";
export const ENTITY_0136 = "CHECK ((entity = ANY (ARRAY['attribution'::text, 'rep-history'::text, 'receipt-event'::text, 'b-override'::text, 'c-review'::text])))";

/* ── files ───────────────────────────────────────────────────────────── */

export const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** The file's text if (and only if) its bytes are the pinned ones and it carries no transaction control of its own. */
export function pinned(name: string, bytes: Uint8Array, sha: string): string {
  const got = sha256(bytes);
  if (got !== sha) throw new Error(`${name} sha256 ${got} is not the pinned ${sha}`);
  const text = Buffer.from(bytes).toString("utf8");
  // Transaction control as a statement of its own — at a line start or after another statement on the same line. (A
  // PL/pgSQL block's BEGIN / END has no semicolon right after it and isn't one; a false refusal is the safe direction.)
  const control = /(^|;)\s*(BEGIN(\s+(WORK|TRANSACTION|ISOLATION\b[^;]*))?\s*;|END(\s+(WORK|TRANSACTION))?\s*;|(COMMIT|ROLLBACK|ABORT)\b[^;]*;|START\s+TRANSACTION\b|SAVEPOINT\b|RELEASE\b|PREPARE\s+TRANSACTION\b)/im;
  if (control.test(text)) throw new Error(`${name} must not contain its own transaction control`);
  return text;
}

/** What a database's 0135 and 0136 states must be, from the pinned files' own text. */
export interface Reference {
  keys0135: string[];
  keys0136: string[];
  fnBody0135: string;
  fnBody0136: string;
}
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`marker not found: ${a.slice(0, 60)}`);
  return s.slice(i + a.length, j);
};
const keysOf = (text: string) => [...between(text, "-- settings-key-list-begin", "-- settings-key-list-end").matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'/g)].map((m) => m[1]!).sort();
const fnBodyOf = (text: string) => between(between(text, `CREATE OR REPLACE FUNCTION "${REPLACED_FN}"()`, "$$;") + "$$;", "AS $$", "$$;");
export function reference(m0135: string, m0136: string): Reference {
  const r = { keys0135: keysOf(m0135), keys0136: keysOf(m0136), fnBody0135: fnBodyOf(m0135), fnBody0136: fnBodyOf(m0136) };
  const added = r.keys0136.filter((k) => !r.keys0135.includes(k)).sort();
  if (added.join() !== [...NEW_KEYS].sort().join() || r.keys0135.some((k) => !r.keys0136.includes(k))) throw new Error("0136's settings list isn't 0135's plus exactly its six keys");
  return r;
}

/* ── the target ──────────────────────────────────────────────────────── */

/** The fingerprint of a connection URL (user@host:port/path → sha256, 10 hex) — the URL itself is never printed. */
/** A parsed URL — an unparseable one is refused WITHOUT echoing it (it may hold a password). */
function parse(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error("the connection URL can't be read (not shown)");
  }
}
export function fingerprintOf(url: string): string {
  const u = parse(url);
  return sha256(`${decodeURIComponent(u.username)}@${u.hostname}:${u.port}${u.pathname}`).slice(0, 10);
}
/** Refuses anything but production's exact fingerprint on a Supabase host. */
export function assertProduction(url: string): { fingerprint: string; port: string } {
  const u = parse(url);
  const fp = fingerprintOf(url);
  if (fp !== PRODUCTION_FINGERPRINT) throw new Error(`target fingerprint ${fp} is not production (${PRODUCTION_FINGERPRINT})`);
  if (!/\.supabase\.(com|co)$/.test(u.hostname)) throw new Error("target host is not a Supabase host");
  return { fingerprint: fp, port: u.port };
}

/* ── reads ───────────────────────────────────────────────────────────── */

const SAFE = /^[A-Za-z0-9_.:\-]+$/;
/** A SQL list of constant names: 'a', 'b'. Constants only — anything else is refused. */
export const lit = (xs: readonly string[]) => {
  for (const x of xs) if (!SAFE.test(x)) throw new Error(`unsafe identifier ${x}`);
  return xs.map((x) => `'${x}'`).join(", ");
};
const isNew = (name: string) => NEW_TABLES.some((t) => name === t || name.startsWith(`${t}_`));
const keysInDef = (def: string | undefined) => [...(def ?? "").matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'::text/g)].map((m) => m[1]!).sort();

export async function checkRole(x: Exec) {
  const [r] = await x.query<{ u: string; db: string; b: boolean; vn: number; v: string }>(`select current_user u, current_database() db, r.rolbypassrls b, current_setting('server_version_num')::int vn, current_setting('server_version') v from pg_roles r where r.rolname = current_user`);
  if (!r || r.vn < 150000) throw new Error(`Postgres ${r?.v}: 15 or later needed`);
  if (r.u !== "postgres" || !r.b || r.db !== "postgres") throw new Error(`unexpected role/db (${r.u}, ${r.db}, bypass ${r.b})`);
  return r;
}
/** Ledger rows in code-unit order (never a database collation). */
export const ledgerRows = async (x: Exec) => (await x.query<{ filename: string }>(`select filename from public.__schema_applied`)).map((r) => r.filename).sort();

/**
 * Taken FIRST in a commit transaction, before any query fixes its REPEATABLE READ snapshot (LOCK doesn't): EXCLUSIVE
 * mode lets the app read but not write the tables whose rows decide whether the step is safe, so nothing can be written
 * between the checks and the DDL (a rollback would otherwise drop a row committed after its snapshot). Waits at most
 * the transaction's lock_timeout.
 */
export async function lockFor(x: Exec, step: "apply" | "rollback") {
  const tables = step === "apply" ? ["incentive_config_settings", "incentive_config_versions", "incentive_calc_input_history"] : [...NEW_TABLES, "incentive_config_settings", "incentive_config_versions", "incentive_calc_input_history"];
  await x.exec(`LOCK TABLE ${tables.map((t) => `public."${t}"`).join(", ")} IN EXCLUSIVE MODE`);
}
/** The transaction's id: unchanged across the migration text proves no COMMIT / ROLLBACK ran inside it. */
const xid = async (x: Exec) => (await x.query<{ id: string }>(`select txid_current()::text id`))[0]!.id;
export async function tableCount(x: Exec) {
  const [t] = await x.query<{ n: number; rls: number }>(`select count(*)::int n, count(*) filter (where relrowsecurity)::int rls from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')`);
  return t!;
}
/** Which of 0136's own objects exist. */
export async function present(x: Exec) {
  const rels = (await x.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace`)).map((r) => r.relname).filter(isNew);
  const fns = (await x.query<{ proname: string }>(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in (${lit(NEW_FNS)})`)).map((r) => r.proname).sort();
  const [t] = await x.query<{ n: number }>(`select count(*)::int n from pg_trigger where tgname = $1`, [NEW_TRIGGER_ON_EXISTING.name]);
  return { rels: rels.sort(), fns, trigger: t!.n };
}
async function definitions(x: Exec) {
  const defs = Object.fromEntries((await x.query<{ conname: string; d: string; v: boolean }>(`select conname, pg_get_constraintdef(oid) d, convalidated v from pg_constraint where connamespace = 'public'::regnamespace and conname in (${lit(CHANGED_CONSTRAINTS)})`)).map((r) => [r.conname, r]));
  const fnRows = await x.query<{ src: string }>(`select prosrc src from pg_proc where pronamespace = 'public'::regnamespace and proname = $1 and pronargs = 0`, [REPLACED_FN]);
  if (fnRows.length > 1) throw new Error(`${REPLACED_FN} is ambiguous (${fnRows.length} functions)`);
  const fn = fnRows[0];
  return { keys: defs.incentive_config_settings_key_check, entity: defs.incentive_calc_input_history_entity_check, fn: fn?.src };
}
/** The database is exactly at 0135 for everything 0136 changes (as the pinned 0135 / 0134 files define it). */
export async function assert0135(x: Exec, ref: Reference) {
  const d = await definitions(x);
  if (!d.keys?.v || keysInDef(d.keys.d).join() !== ref.keys0135.join()) throw new Error("the settings key check isn't exactly 0135's");
  if (!d.entity?.v || d.entity.d !== ENTITY_0134) throw new Error(`the input-history entity check isn't 0134's: ${d.entity?.d}`);
  if (d.fn !== ref.fnBody0135) throw new Error("the settings-by-category function isn't exactly 0135's");
}

export async function dataFingerprints(x: Exec): Promise<Record<string, string>> {
  const tables = (await x.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and relname <> '__schema_applied' order by relname`)).map((r) => r.relname).filter((t) => !isNew(t));
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [r] = await x.query<{ n: string; h: string }>(`select count(*)::text n, coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') h from public."${t.replace(/"/g, '""')}" t`);
    out[t] = `${r!.n}:${r!.h}`;
  }
  return out;
}
/** The catalogue except 0136's own objects, the two checks it changes, the function it replaces and its trigger on approvals. */
export async function catalogue(x: Exec): Promise<string> {
  const rels = (await x.query<{ relname: string }>(`select c.relname, c.relkind, c.relrowsecurity rls, c.relforcerowsecurity force, pg_get_userbyid(c.relowner) owner, coalesce(c.relacl::text, '') acl from pg_class c where c.relnamespace = 'public'::regnamespace order by c.relname`)).filter((r) => !isNew(r.relname));
  const cols = (await x.query<{ table_name: string }>(`select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') d from information_schema.columns where table_schema = 'public' order by 1, 2`)).filter((r) => !isNew(r.table_name));
  const cons = (await x.query<{ t: string; conname: string }>(`select conrelid::regclass::text t, conname, contype, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)).filter((r) => !isNew(r.t) && !(CHANGED_CONSTRAINTS as readonly string[]).includes(r.conname));
  const idx = (await x.query<{ tablename: string }>(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`)).filter((r) => !isNew(r.tablename));
  const pol = await x.query(`select schemaname, tablename, policyname, permissive, cmd, roles::text, coalesce(qual, '') q, coalesce(with_check, '') w from pg_policies order by 1, 2, 3`);
  // Triggers by their full definition and enabled state (a disabled trigger, or one calling another function, differs).
  const trig = (await x.query<{ t: string; tgname: string }>(`select tgrelid::regclass::text t, tgname, tgenabled::text e, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) order by 1, 2`)).filter((r) => !isNew(r.t) && !(r.t === NEW_TRIGGER_ON_EXISTING.table && r.tgname === NEW_TRIGGER_ON_EXISTING.name));
  // Functions with their owner, security, settings, volatility, arguments and result; the replaced function stays in
  // with everything but its source (checked exactly on its own).
  const fns = (await x.query<{ proname: string; src: string }>(`select proname, pg_get_function_identity_arguments(oid) args, prorettype::regtype::text ret, pg_get_userbyid(proowner) owner, prosecdef secdef, coalesce(proconfig::text, '') config, provolatile::text vol, md5(prosrc) src, coalesce(proacl::text, '') acl from pg_proc where pronamespace = 'public'::regnamespace order by 1, 2`))
    .filter((r) => !(NEW_FNS as readonly string[]).includes(r.proname))
    .map((r) => (r.proname === REPLACED_FN ? { ...r, src: "(replaced: compared exactly on its own)" } : r));
  const types = await x.query(`select t.typname, t.typtype::text k, coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '') labels from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e', 'd', 'c') and not exists (select 1 from pg_class c where c.reltype = t.oid) order by 1`);
  const seqs = (await x.query<{ sequencename: string }>(`select sequencename, data_type::text, start_value::text, increment_by::text, min_value::text, max_value::text, cycle from pg_sequences where schemaname = 'public' order by 1`)).filter((r) => !isNew(r.sequencename));
  const comments = (await x.query<{ o: string }>(`select c.relname o, d.objsubid, d.description from pg_description d join pg_class c on c.oid = d.objoid where d.classoid = 'pg_class'::regclass and c.relnamespace = 'public'::regnamespace order by 1, 2`)).filter((r) => !isNew(r.o));
  const defaults = await x.query(`select pg_get_userbyid(defaclrole) role, coalesce(defaclnamespace::regnamespace::text, '') ns, defaclobjtype::text t, defaclacl::text acl from pg_default_acl order by 1, 2, 3`);
  return JSON.stringify({ rels, cols, cons, idx, pol, trig, fns, types, seqs, comments, defaults });
}

/**
 * A canonical listing of every object 0136 creates (owners and grants left out: Supabase's defaults differ from a
 * local database's; the tables' REST access is checked separately). Its sha256 is pinned as CANON_0136, taken from
 * the migration applied on PGlite (Postgres 17) by tests/integration/incentive-0136-runners.db.test.ts.
 */
export const CANON_0136 = "f3c2aadb4164339fee75f95bb9adc016b00a894e39a3bfff4e5f1b9c4b615cbd";
export async function canonical0136(x: Exec): Promise<string> {
  const tables = lit(NEW_TABLES);
  const cols = await x.query(`select c.relname t, a.attnum n, a.attname, format_type(a.atttypid, a.atttypmod) ty, a.attnotnull nn, coalesce(pg_get_expr(d.adbin, d.adrelid), '') def from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where c.relnamespace = 'public'::regnamespace and c.relname in (${tables}) and a.attnum > 0 and not a.attisdropped order by 1, 2`);
  const cons = await x.query(`select conrelid::regclass::text t, conname, contype::text k, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text in (${tables}) order by 1, 2`);
  const idx = await x.query(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in (${tables}) order by 1, 2`);
  const fns = await x.query(`select proname, pg_get_function_identity_arguments(oid) args, prorettype::regtype::text ret, md5(prosrc) src, prosecdef secdef, coalesce(proconfig::text, '') config, provolatile::text vol, (select lanname from pg_language l where l.oid = prolang) lang from pg_proc where pronamespace = 'public'::regnamespace and proname in (${lit(NEW_FNS)}) order by 1, 2`);
  const trig = await x.query(`select tgrelid::regclass::text t, tgname, tgenabled::text e, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and (tgrelid::regclass::text in (${tables}) or tgname = $1) order by 1, 2`, [NEW_TRIGGER_ON_EXISTING.name]);
  return JSON.stringify({ cols, cons, idx, fns, trig });
}

/** Every 0136 object exactly as pinned (and, unless allowed, every new table empty). Returns the table count. */
export async function assert0136(x: Exec, ref: Reference, opts: { requireEmpty: boolean } = { requireEmpty: true }) {
  for (const [t, want] of Object.entries(EXPECT_COLS)) {
    const got = (await x.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).map((r) => r.c).join(",");
    if (got !== want) throw new Error(`${t} columns unexpected: ${got || "(missing)"}`);
  }
  const fks = (await x.query<{ t: string; r: string; d: string }>(`select conrelid::regclass::text t, confrelid::regclass::text r, confdeltype::text d from pg_constraint where contype = 'f' and conrelid::regclass::text in (${lit(NEW_TABLES)})`)).map((r) => `${r.t}>${r.r}:${r.d}`).sort();
  if (fks.join() !== EXPECT_FKS.join()) throw new Error(`foreign keys unexpected: ${fks.join(",")}`);
  const trig = (await x.query<{ x: string }>(`select c.relname || ':' || t.tgname x from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in (${lit(NEW_TABLES)})`)).map((r) => r.x).sort();
  if (trig.join() !== EXPECT_TRIGGERS.join()) throw new Error(`triggers unexpected: ${trig.join(",")}`);
  const p = await present(x);
  if (p.fns.join() !== [...NEW_FNS].sort().join() || p.trigger !== 1) throw new Error(`functions / approvals trigger unexpected: ${p.fns.join(",")} · ${p.trigger}`);
  const d = await definitions(x);
  if (d.fn !== ref.fnBody0136) throw new Error("the settings-by-category function isn't exactly 0136's");
  if (!d.entity?.v || d.entity.d !== ENTITY_0136) throw new Error(`input-history entity check unexpected: ${d.entity?.d}`);
  const keys = keysInDef(d.keys?.d);
  if (!d.keys?.v || keys.join() !== ref.keys0136.join()) throw new Error(`settings key check unexpected: ${keys.length} keys (file ${ref.keys0136.length})`);
  const idx = Object.fromEntries((await x.query<{ indexname: string; indexdef: string }>(`select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname in (${lit(Object.keys(UNIQUES))})`)).map((r) => [r.indexname, r.indexdef]));
  for (const [name, re] of Object.entries(UNIQUES)) if (!idx[name]?.startsWith("CREATE UNIQUE INDEX") || !re.test(idx[name]!)) throw new Error(`unique index ${name} unexpected: ${idx[name] ?? "(missing)"}`);
  // Everything else about the new objects, at once: column types, nullability and defaults, every constraint and
  // index, the four functions (arguments, result, source, security, settings, volatility) and every trigger's full
  // definition and enabled state — against the canonical listing pinned from the migration.
  const canon = sha256(await canonical0136(x));
  if (canon !== CANON_0136) throw new Error(`0136's objects differ from the pinned listing (canonical sha256 ${canon})`);
  const rows: Record<string, number> = {};
  for (const t of NEW_TABLES) {
    const [s] = await x.query<{ rls: boolean; f: boolean; pol: number; rest: boolean | null }>(
      `select c.relrowsecurity rls, c.relforcerowsecurity f, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol,
         (select bool_or(has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) from pg_roles r where r.rolname in ('anon', 'authenticated')) rest
       from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = $1`,
      [t],
    );
    if (!s || !s.rls || s.f || s.pol !== 0 || s.rest) throw new Error(`security unexpected on ${t}: ${JSON.stringify(s ?? null)}`);
    const [n] = await x.query<{ n: number }>(`select count(*)::int n from public."${t}"`);
    rows[t] = n!.n;
    if (opts.requireEmpty && n!.n !== 0) throw new Error(`${t} is not empty (${n!.n} rows)`);
  }
  return { ...(await tableCount(x)), rows, keys: keys.length };
}

/** Data only 0136 allows, anywhere: why a rollback must refuse (null when there is none). */
export async function data0136(x: Exec): Promise<string | null> {
  const found: string[] = [];
  for (const t of NEW_TABLES) {
    const exists = (await present(x)).rels.includes(t);
    if (!exists) continue;
    const [n] = await x.query<{ n: number }>(`select count(*)::int n from public."${t}"`);
    if (n!.n) found.push(`${t}: ${n!.n} rows`);
  }
  const [h] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_calc_input_history where entity = 'c-review'`);
  if (h!.n) found.push(`c-review input history: ${h!.n}`);
  const [k] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_config_settings where setting_key in (${lit(NEW_KEYS)})`);
  if (k!.n) found.push(`settings using 0136's keys: ${k!.n}`);
  const [c] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_config_settings s join public.incentive_config_versions v on v.id = s.version_id where v.category_code = 'C' and s.setting_key in (${lit(SHARED_WITH_C)})`);
  if (c!.n) found.push(`Category C settings using Category A's shared keys: ${c!.n}`);
  return found.length ? found.join("; ") : null;
}

/* ── apply ───────────────────────────────────────────────────────────── */

export async function preApply(x: Exec, e: Expect, ref: Reference) {
  if (e.role) await checkRole(x);
  let ledger: string[] = [];
  if (e.ledger) {
    ledger = await ledgerRows(x);
    if (ledger.length !== e.ledger.before || new Set(ledger).size !== ledger.length) throw new Error(`ledger has ${ledger.length} rows; expected ${e.ledger.before} without duplicates`);
    if (ledger.at(-1) !== FILES.m0135) throw new Error(`last ledger row is ${ledger.at(-1)}; ${FILES.m0135} must be last`);
    for (const need of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", FILES.m0134]) if (!ledger.includes(need)) throw new Error(`${need} is missing from the ledger`);
    if (ledger.some((f) => f >= "0136")) throw new Error("0136 (or a later file) is already recorded in the ledger");
  }
  const t = await tableCount(x);
  if (t.n !== e.tables.before || t.rls !== t.n) throw new Error(`expected ${e.tables.before} public tables all with RLS, found ${t.n} (${t.rls} with RLS)`);
  const p = await present(x);
  if (p.rels.length || p.fns.length || p.trigger) throw new Error(`0136's objects already (partly) exist — the state is ambiguous: ${JSON.stringify(p)}`);
  const [items] = await x.query<{ ok: boolean }>(`select to_regclass('public.incentive_calc_items') is not null ok`);
  if (!items!.ok) throw new Error("0135 isn't applied (incentive_calc_items is missing)");
  await assert0135(x, ref);
  const [k] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_config_settings where setting_key in (${lit(NEW_KEYS)})`);
  if (k!.n) throw new Error(`${k!.n} settings already use 0136's keys`);
  return { ledger, tables: t };
}

/** Applies 0136 inside the caller's transaction; throws (so the caller rolls back) on any difference. */
export async function applyIn(x: Exec, migration: string, e: Expect, ref: Reference) {
  await lockFor(x, "apply"); // before any query fixes the snapshot
  const pre = await preApply(x, e, ref);
  const dataBefore = await dataFingerprints(x);
  const catBefore = await catalogue(x);
  const id = await xid(x);
  await x.exec(migration);
  if ((await xid(x)) !== id) throw new Error("the migration text ended the transaction (COMMIT / ROLLBACK inside it)");
  if (e.ledger) await x.query(`insert into public.__schema_applied (filename) values ($1)`, [FILES.migration]);
  const dataAfter = await dataFingerprints(x);
  const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((t) => dataBefore[t] !== dataAfter[t]);
  if (changed.length) throw new Error(`existing data changed in: ${changed.join(", ")}`);
  if ((await catalogue(x)) !== catBefore) throw new Error("an existing relation, column, constraint, index, policy, trigger or function changed beyond 0136's own");
  if (e.ledger) {
    const after = await ledgerRows(x);
    const added = after.filter((f) => !pre.ledger.includes(f));
    if (after.length !== e.ledger.after || added.join() !== FILES.migration) throw new Error(`ledger change unexpected: ${after.length} rows (+${added.join(",")})`);
  }
  const n = await assert0136(x, ref);
  if (n.n !== e.tables.after || n.rls !== n.n) throw new Error(`expected ${e.tables.after} public tables all with RLS, found ${n.n} (${n.rls})`);
  return { tablesFingerprinted: Object.keys(dataBefore).length, tables: n.n, keys: n.keys };
}

/* ── rollback ────────────────────────────────────────────────────────── */

export async function preRollback(x: Exec, e: Expect, ref: Reference) {
  if (e.role) await checkRole(x);
  let ledger: string[] = [];
  if (e.ledger) {
    ledger = await ledgerRows(x);
    if (ledger.length !== e.ledger.after || new Set(ledger).size !== ledger.length) throw new Error(`ledger has ${ledger.length} rows; expected ${e.ledger.after} without duplicates`);
    if (ledger.at(-1) !== FILES.migration) throw new Error(`last ledger row is ${ledger.at(-1)}; ${FILES.migration} must be last`);
  }
  const why = await data0136(x);
  if (why) throw new Error(`rollback refused: data only 0136 allows exists (${why})`);
  // Exactly 0136 as pinned (all three tables present, empty, secured) — anything else is an ambiguous state.
  const n = await assert0136(x, ref);
  if (n.n !== e.tables.after || n.rls !== n.n) throw new Error(`expected ${e.tables.after} public tables all with RLS, found ${n.n} (${n.rls})`);
  return { ledger };
}

/** Rolls 0136 back inside the caller's transaction; the rollback SQL's own refusal still runs. Throws on any difference. */
export async function rollbackIn(x: Exec, rollback: string, e: Expect, ref: Reference) {
  await lockFor(x, "rollback"); // before any query fixes the snapshot: no 0136 row can be written after the checks
  const pre = await preRollback(x, e, ref);
  const dataBefore = await dataFingerprints(x);
  const catBefore = await catalogue(x);
  const id = await xid(x);
  await x.exec(rollback);
  if ((await xid(x)) !== id) throw new Error("the rollback text ended the transaction (COMMIT / ROLLBACK inside it)");
  if (e.ledger) await x.query(`delete from public.__schema_applied where filename = $1`, [FILES.migration]);
  const dataAfter = await dataFingerprints(x);
  const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((t) => dataBefore[t] !== dataAfter[t]);
  if (changed.length) throw new Error(`existing data changed in: ${changed.join(", ")}`);
  if ((await catalogue(x)) !== catBefore) throw new Error("an existing relation, column, constraint, index, policy, trigger or function changed beyond 0136's own");
  const p = await present(x);
  if (p.rels.length || p.fns.length || p.trigger) throw new Error(`0136's objects remain: ${JSON.stringify(p)}`);
  await assert0135(x, ref);
  if (e.ledger) {
    const after = await ledgerRows(x);
    if (after.length !== e.ledger.before || after.includes(FILES.migration) || pre.ledger.filter((f) => f !== FILES.migration).join() !== after.join()) throw new Error(`ledger change unexpected: ${after.length} rows`);
  }
  const t = await tableCount(x);
  if (t.n !== e.tables.before || t.rls !== t.n) throw new Error(`expected ${e.tables.before} public tables all with RLS, found ${t.n} (${t.rls})`);
  return { tablesFingerprinted: Object.keys(dataBefore).length, tables: t.n };
}

/* ── verification (read-only) ─────────────────────────────────────────── */

/** After a committed rollback: 0136 gone, 0135 exact, ledger and tables as before 0136. */
export async function verifyRolledBack(x: Exec, e: Expect, ref: Reference) {
  const out: { ok: boolean; check: string }[] = [];
  const ok = (cond: boolean, check: string) => out.push({ ok: cond, check });
  const p = await present(x);
  ok(!p.rels.length && !p.fns.length && !p.trigger, `0136's objects absent (${JSON.stringify(p)})`);
  try {
    await assert0135(x, ref);
    ok(true, "0135's function and settings list and 0134's entity check exactly restored");
  } catch (err) {
    ok(false, (err as Error).message);
  }
  if (e.ledger) {
    const ledger = await ledgerRows(x);
    ok(ledger.length === e.ledger.before && !ledger.includes(FILES.migration) && ledger.at(-1) === FILES.m0135, `ledger ${ledger.length} rows, last ${ledger.at(-1)}`);
  }
  const t = await tableCount(x);
  ok(t.n === e.tables.before && t.rls === t.n, `${t.n} public tables, ${t.rls} with RLS`);
  return out;
}

export async function verifyApplied(x: Exec, e: Expect, ref: Reference, opts: { requireEmpty: boolean }) {
  const out: { ok: boolean; check: string }[] = [];
  const ok = (cond: boolean, check: string) => out.push({ ok: cond, check });
  if (e.ledger) {
    const ledger = await ledgerRows(x);
    ok(ledger.length === e.ledger.after && new Set(ledger).size === ledger.length && ledger.at(-1) === FILES.migration && ledger.includes(FILES.m0135), `ledger ${ledger.length} rows, last ${ledger.at(-1)}`);
  }
  try {
    const n = await assert0136(x, ref, opts);
    ok(true, `0136's tables, columns, foreign keys, triggers, functions, unique indexes, checks (${n.keys} settings keys) and security exactly as pinned; rows ${JSON.stringify(n.rows)}`);
    ok(n.n === e.tables.after && n.rls === n.n, `${n.n} public tables, ${n.rls} with RLS`);
  } catch (err) {
    ok(false, (err as Error).message);
  }
  return out;
}
