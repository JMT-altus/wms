import { assertProduction, canonicalBytes, checkRole, fingerprintOf, ledgerRows, lit, pinned, sha256, tableCount, type Exec } from "../incentive-0136/core";

/**
 * Migration 0137 (Category F, Google reviews) — the SAFETY LOGIC of its apply, rollback and verification runners, apart
 * from any connection so it is proven on an in-memory PGlite database (tests/integration/incentive-0137-runners.db.test.ts).
 * The reviewed 0136 primitives are reused (pinning of the canonical LF bytes, the production fingerprint, the role,
 * ledger and table checks). 0137 also changes two EXISTING tables, so those are compared on their own:
 *   testimonials             employee_id NOT NULL / ON DELETE CASCADE → nullable / ON DELETE SET NULL, + employee_name
 *                            (filled for every row: its data is compared without that column), + a fill trigger and a check;
 *   incentive_calc_adjustments  the kind and target checks widened for 'recovery-write-off', + a write-off check.
 * Every function throws on anything unexpected; the caller's transaction then rolls everything back.
 */
export { assertProduction, canonicalBytes, checkRole, fingerprintOf, ledgerRows, lit, pinned, sha256, tableCount, type Exec };

export const FILES = {
  migration: "0137_incentive_category_f_reviews.sql",
  rollback: "0137_incentive_category_f_reviews.rollback.sql",
  m0136: "0136_incentive_category_c_review.sql",
} as const;
export const PINS = {
  migration: "cdb113767678f95635b3d03e1090c4e86b3566963bb53b48d484a02fe736962d",
  rollback: "d40dac5c9e2dc57375d5bc5715820d4c3f15094e1156f1a24478ce2ef88019fe",
  /** As applied to production on 2026-11-19 (its settings list is what a rollback restores). */
  m0136: "069f173c003bc057e0b21577d13e8650c9298b417eb48a7ec99d8da8688052ea",
} as const;
export const PRODUCTION_FINGERPRINT = "ed679a28f0";

export interface Expect {
  ledger: { before: number; after: number } | null;
  tables: { before: number; after: number };
  role: boolean;
}
/** Production after 0136 (verified read-only on 2026-11-19): ledger 149, 166 public tables. */
export const PRODUCTION: Expect = { ledger: { before: 149, after: 150 }, tables: { before: 166, after: 170 }, role: true };

export const NEW_TABLES = ["incentive_f_reviews", "incentive_f_submissions", "incentive_f_decisions", "incentive_f_writeoffs"] as const;
export const NEW_FNS = ["incentive_f_decisions_check", "incentive_f_decisions_guard", "incentive_f_writeoffs_check", "incentive_calc_f_approvals_check", "testimonials_employee_name_fill"] as const;
export const CHANGED_CONSTRAINTS = ["incentive_config_settings_key_check", "incentive_calc_input_history_entity_check", "incentive_calc_adjustments_kind_check", "incentive_calc_adjustments_target_check", "incentive_calc_adjustments_writeoff_check"] as const;
export const NEW_TRIGGERS_ON_EXISTING = [
  { table: "incentive_calc_approvals", name: "incentive_calc_f_approvals_insert" },
  { table: "testimonials", name: "testimonials_employee_name" },
] as const;
export const NEW_KEYS = ["f.namedBonusAmount", "f.minRating", "f.minQualifyingReviews", "f.recoveryExpiry"] as const;
export const EXPECT_COLS: Record<(typeof NEW_TABLES)[number], string> = {
  incentive_f_reviews: "id,google_review_id,url_key,first_url,place_id,source,created_by_id,created_by_name,created_at",
  incentive_f_submissions: "id,testimonial_id,review_id,link_state,submitted_by_id,submitted_by_name,submitted_url,url_key,google_review_id,screenshot_url,claimed_rating,claimed_published_on,claimed_text,created_at",
  incentive_f_decisions: "id,review_id,submission_id,kind,request_id,rating,published_on,review_month,review_text,google_review_id,named_employee_ids,named_employee_names,customer_master_id,credited_employee_id,credited_employee_name,basis,reason,evidence_url,created_by_id,created_by_name,created_at,retired_at,retired_by_id,retired_reason",
  incentive_f_writeoffs: "id,kind,request_id,adjustment_id,result_adjustment_id,employee_id,employee_name,amount_paise,reason,evidence_url,created_by_id,created_by_name,created_at",
};
export const ENTITY_0136 = "CHECK ((entity = ANY (ARRAY['attribution'::text, 'rep-history'::text, 'receipt-event'::text, 'b-override'::text, 'c-review'::text])))";
export const ENTITY_0137 = "CHECK ((entity = ANY (ARRAY['attribution'::text, 'rep-history'::text, 'receipt-event'::text, 'b-override'::text, 'c-review'::text, 'f-decision'::text])))";
export const ADJ_0132 = {
  kind: "CHECK ((kind = ANY (ARRAY['recalc-difference'::text, 'negative-carry'::text, 'write-off'::text, 'salary-recovery'::text])))",
  target: "CHECK (((kind = ANY (ARRAY['recalc-difference'::text, 'negative-carry'::text])) = (to_month IS NOT NULL)))",
};
export const ADJ_0137 = {
  kind: "CHECK ((kind = ANY (ARRAY['recalc-difference'::text, 'negative-carry'::text, 'write-off'::text, 'salary-recovery'::text, 'recovery-write-off'::text])))",
  target: "CHECK (((kind = ANY (ARRAY['recalc-difference'::text, 'negative-carry'::text, 'recovery-write-off'::text])) = (to_month IS NOT NULL)))",
  writeoff: "CHECK (((kind <> 'recovery-write-off'::text) OR ((amount_paise > 0) AND (category_code = 'F'::text))))",
};
/** sha256 of the canonical listing of every object 0137 creates, taken from the migration applied on PGlite (Postgres 17). */
export const CANON_0137 = "3045d2402efe1e93fe24918e1cad42045d1eab46cc88138f0717ab39e02bfdda";

/* ── references from the pinned files ─────────────────────────────────── */

export interface Reference {
  keys0136: string[];
  keys0137: string[];
}
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`marker not found: ${a.slice(0, 60)}`);
  return s.slice(i + a.length, j);
};
const keysOf = (text: string) => [...between(text, "-- settings-key-list-begin", "-- settings-key-list-end").matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'/g)].map((m) => m[1]!).sort();
export function reference(m0136: string, m0137: string): Reference {
  const r = { keys0136: keysOf(m0136), keys0137: keysOf(m0137) };
  const added = r.keys0137.filter((k) => !r.keys0136.includes(k)).sort();
  if (added.join() !== [...NEW_KEYS].sort().join() || r.keys0136.some((k) => !r.keys0137.includes(k))) throw new Error("0137's settings list isn't 0136's plus exactly its four keys");
  return r;
}

/* ── reads ───────────────────────────────────────────────────────────── */

const isNew = (name: string) => NEW_TABLES.some((t) => name === t || name.startsWith(`${t}_`));
const keysInDef = (def: string | undefined) => [...(def ?? "").matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'::text/g)].map((m) => m[1]!).sort();
const isNewTrigger = (t: string, n: string) => NEW_TRIGGERS_ON_EXISTING.some((x) => x.table === t && x.name === n);

/** Which of 0137's own objects exist (tables, functions, triggers on existing tables, the testimonials name column). */
export async function present(x: Exec) {
  const rels = (await x.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace`)).map((r) => r.relname).filter(isNew).sort();
  const fns = (await x.query<{ proname: string }>(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in (${lit(NEW_FNS)})`)).map((r) => r.proname).sort();
  const [t] = await x.query<{ n: number }>(`select count(*)::int n from pg_trigger where tgname in (${lit(NEW_TRIGGERS_ON_EXISTING.map((x) => x.name))})`);
  const [c] = await x.query<{ n: number }>(`select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'testimonials' and column_name = 'employee_name'`);
  return { rels, fns, triggers: t!.n, nameColumn: c!.n };
}
async function definitions(x: Exec) {
  return Object.fromEntries((await x.query<{ conname: string; d: string; v: boolean }>(`select conname, pg_get_constraintdef(oid) d, convalidated v from pg_constraint where connamespace = 'public'::regnamespace and conname in (${lit(CHANGED_CONSTRAINTS)})`)).map((r) => [r.conname, r]));
}
/** testimonials' employee link: nullable?, and its foreign key's delete rule (one FK on employee_id). */
async function testimonialsLink(x: Exec) {
  const [col] = await x.query<{ n: string }>(`select is_nullable n from information_schema.columns where table_schema = 'public' and table_name = 'testimonials' and column_name = 'employee_id'`);
  const fks = await x.query<{ conname: string; d: string }>(
    `select con.conname, con.confdeltype::text d from pg_constraint con where con.conrelid = 'public.testimonials'::regclass and con.contype = 'f' and con.confrelid = 'public.employees'::regclass
       and con.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'public.testimonials'::regclass and a.attname = 'employee_id')]::smallint[]`,
  );
  return { nullable: col?.n === "YES", fks };
}

/** The database is exactly at 0136 for everything 0137 changes. */
export async function assert0136(x: Exec, ref: Reference) {
  const d = await definitions(x);
  if (!d.incentive_config_settings_key_check?.v || keysInDef(d.incentive_config_settings_key_check.d).join() !== ref.keys0136.join()) throw new Error("the settings key check isn't exactly 0136's");
  if (!d.incentive_calc_input_history_entity_check?.v || d.incentive_calc_input_history_entity_check.d !== ENTITY_0136) throw new Error(`the input-history entity check isn't 0136's: ${d.incentive_calc_input_history_entity_check?.d}`);
  if (d.incentive_calc_adjustments_kind_check?.d !== ADJ_0132.kind || d.incentive_calc_adjustments_target_check?.d !== ADJ_0132.target) throw new Error("the adjustment kind / target checks aren't 0132's");
  if (d.incentive_calc_adjustments_writeoff_check) throw new Error("the adjustment write-off check already exists");
  const t = await testimonialsLink(x);
  if (t.nullable || t.fks.length !== 1 || t.fks[0]!.d !== "c") throw new Error(`testimonials.employee_id isn't 0068's (NOT NULL, ON DELETE CASCADE): ${JSON.stringify(t)}`);
}

/** Every table's data — testimonials without the employee_name 0137 adds and fills; 0137's own tables left out. */
export async function dataFingerprints(x: Exec): Promise<Record<string, string>> {
  const tables = (await x.query<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and relname <> '__schema_applied' order by relname`)).map((r) => r.relname).filter((t) => !isNew(t));
  const out: Record<string, string> = {};
  for (const t of tables) {
    const row = t === "testimonials" ? `(to_jsonb(t) - 'employee_name')::text` : `t::text`;
    const [r] = await x.query<{ n: string; h: string }>(`select count(*)::text n, coalesce(md5(string_agg(md5(${row}), '' order by md5(${row}))), '') h from public."${t.replace(/"/g, '""')}" t`);
    out[t] = `${r!.n}:${r!.h}`;
  }
  return out;
}

/** The catalogue except 0137's own objects, the checks it widens, and testimonials (compared on its own). */
export async function catalogue(x: Exec): Promise<string> {
  const skip = (t: string) => isNew(t) || t === "testimonials";
  const rels = (await x.query<{ relname: string }>(`select c.relname, c.relkind, c.relrowsecurity rls, c.relforcerowsecurity force, pg_get_userbyid(c.relowner) owner, coalesce(c.relacl::text, '') acl from pg_class c where c.relnamespace = 'public'::regnamespace order by c.relname`)).filter((r) => !isNew(r.relname));
  const cols = (await x.query<{ table_name: string }>(`select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') d from information_schema.columns where table_schema = 'public' order by 1, 2`)).filter((r) => !skip(r.table_name));
  const cons = (await x.query<{ t: string; conname: string }>(`select conrelid::regclass::text t, conname, contype, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)).filter((r) => !skip(r.t) && !(CHANGED_CONSTRAINTS as readonly string[]).includes(r.conname));
  const idx = (await x.query<{ tablename: string }>(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`)).filter((r) => !isNew(r.tablename));
  const pol = await x.query(`select schemaname, tablename, policyname, permissive, cmd, roles::text, coalesce(qual, '') q, coalesce(with_check, '') w from pg_policies order by 1, 2, 3`);
  const trig = (await x.query<{ t: string; tgname: string }>(`select tgrelid::regclass::text t, tgname, tgenabled::text e, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) order by 1, 2`)).filter((r) => !isNew(r.t) && !isNewTrigger(r.t, r.tgname));
  const fns = (await x.query<{ proname: string }>(`select proname, pg_get_function_identity_arguments(oid) args, prorettype::regtype::text ret, pg_get_userbyid(proowner) owner, prosecdef secdef, coalesce(proconfig::text, '') config, provolatile::text vol, md5(prosrc) src, coalesce(proacl::text, '') acl from pg_proc where pronamespace = 'public'::regnamespace order by 1, 2`)).filter((r) => !(NEW_FNS as readonly string[]).includes(r.proname));
  const types = await x.query(`select t.typname, t.typtype::text k, coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '') labels from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e', 'd', 'c') and not exists (select 1 from pg_class c where c.reltype = t.oid) order by 1`);
  const seqs = (await x.query<{ sequencename: string }>(`select sequencename, data_type::text, start_value::text, increment_by::text, min_value::text, max_value::text, cycle from pg_sequences where schemaname = 'public' order by 1`)).filter((r) => !isNew(r.sequencename));
  const comments = (await x.query<{ o: string }>(`select c.relname o, d.objsubid, d.description from pg_description d join pg_class c on c.oid = d.objoid where d.classoid = 'pg_class'::regclass and c.relnamespace = 'public'::regnamespace order by 1, 2`)).filter((r) => !isNew(r.o));
  const defaults = await x.query(`select pg_get_userbyid(defaclrole) role, coalesce(defaclnamespace::regnamespace::text, '') ns, defaclobjtype::text t, defaclacl::text acl from pg_default_acl order by 1, 2, 3`);
  return JSON.stringify({ rels, cols, cons, idx, pol, trig, fns, types, seqs, comments, defaults });
}

/** testimonials as 0068 left it, minus what 0137 changes: its other columns, constraints and indexes, unchanged. */
export async function testimonialsRest(x: Exec): Promise<string> {
  const cols = await x.query(`select column_name, data_type, is_nullable, coalesce(column_default, '') d from information_schema.columns where table_schema = 'public' and table_name = 'testimonials' and column_name not in ('employee_id', 'employee_name') order by 1`);
  const cons = (await x.query<{ conname: string; def: string }>(`select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'public.testimonials'::regclass order by 1`)).filter((r) => !/FOREIGN KEY \(employee_id\)/.test(r.def) && r.conname !== "testimonials_employee_named_check");
  const idx = await x.query(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'testimonials' order by 1`);
  const trig = (await x.query<{ tgname: string }>(`select tgname, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgrelid = 'public.testimonials'::regclass order by 1`)).filter((r) => r.tgname !== "testimonials_employee_name");
  return JSON.stringify({ cols, cons, idx, trig });
}

export async function canonical0137(x: Exec): Promise<string> {
  const tables = lit(NEW_TABLES);
  const cols = await x.query(`select c.relname t, a.attnum n, a.attname, format_type(a.atttypid, a.atttypmod) ty, a.attnotnull nn, coalesce(pg_get_expr(d.adbin, d.adrelid), '') def from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where c.relnamespace = 'public'::regnamespace and c.relname in (${tables}) and a.attnum > 0 and not a.attisdropped order by 1, 2`);
  const cons = await x.query(`select conrelid::regclass::text t, conname, contype::text k, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text in (${tables}) order by 1, 2`);
  const idx = await x.query(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in (${tables}) order by 1, 2`);
  const fns = await x.query(`select proname, pg_get_function_identity_arguments(oid) args, prorettype::regtype::text ret, md5(prosrc) src, prosecdef secdef, coalesce(proconfig::text, '') config, provolatile::text vol, (select lanname from pg_language l where l.oid = prolang) lang from pg_proc where pronamespace = 'public'::regnamespace and proname in (${lit(NEW_FNS)}) order by 1, 2`);
  const trig = await x.query(`select tgrelid::regclass::text t, tgname, tgenabled::text e, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and (tgrelid::regclass::text in (${tables}) or tgname in (${lit(NEW_TRIGGERS_ON_EXISTING.map((t) => t.name))})) order by 1, 2`);
  const named = await x.query(`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'testimonials_employee_named_check'`);
  return JSON.stringify({ cols, cons, idx, fns, trig, named });
}

/** Every 0137 object exactly as pinned (and, unless allowed, its tables empty). */
export async function assert0137(x: Exec, ref: Reference, opts: { requireEmpty: boolean } = { requireEmpty: true }) {
  for (const [t, want] of Object.entries(EXPECT_COLS)) {
    const got = (await x.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).map((r) => r.c).join(",");
    if (got !== want) throw new Error(`${t} columns unexpected: ${got || "(missing)"}`);
  }
  const p = await present(x);
  if (p.fns.join() !== [...NEW_FNS].sort().join() || p.triggers !== NEW_TRIGGERS_ON_EXISTING.length || p.nameColumn !== 1) throw new Error(`functions / triggers / testimonials.employee_name unexpected: ${JSON.stringify(p)}`);
  const d = await definitions(x);
  const keys = keysInDef(d.incentive_config_settings_key_check?.d);
  if (!d.incentive_config_settings_key_check?.v || keys.join() !== ref.keys0137.join()) throw new Error(`settings key check unexpected: ${keys.length} keys (file ${ref.keys0137.length})`);
  if (!d.incentive_calc_input_history_entity_check?.v || d.incentive_calc_input_history_entity_check.d !== ENTITY_0137) throw new Error(`input-history entity check unexpected: ${d.incentive_calc_input_history_entity_check?.d}`);
  for (const [k, want] of [["incentive_calc_adjustments_kind_check", ADJ_0137.kind], ["incentive_calc_adjustments_target_check", ADJ_0137.target], ["incentive_calc_adjustments_writeoff_check", ADJ_0137.writeoff]] as const)
    if (!d[k]?.v || d[k]!.d !== want) throw new Error(`${k} unexpected: ${d[k]?.d}`);
  const t = await testimonialsLink(x);
  if (!t.nullable || t.fks.length !== 1 || t.fks[0]!.d !== "n" || t.fks[0]!.conname !== "testimonials_employee_id_fkey") throw new Error(`testimonials.employee_id isn't nullable ON DELETE SET NULL: ${JSON.stringify(t)}`);
  const [unnamed] = await x.query<{ n: number }>(`select count(*)::int n from public.testimonials where employee_name is null`);
  if (unnamed!.n) throw new Error(`${unnamed!.n} testimonials have no employee name`);
  const canon = sha256(await canonical0137(x));
  if (canon !== CANON_0137) throw new Error(`0137's objects differ from the pinned listing (canonical sha256 ${canon})`);
  const rows: Record<string, number> = {};
  for (const table of NEW_TABLES) {
    const [s] = await x.query<{ rls: boolean; f: boolean; pol: number; rest: boolean | null }>(
      `select c.relrowsecurity rls, c.relforcerowsecurity f, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol,
         (select bool_or(has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) from pg_roles r where r.rolname in ('anon', 'authenticated')) rest
       from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = $1`,
      [table],
    );
    if (!s || !s.rls || s.f || s.pol !== 0 || s.rest) throw new Error(`security unexpected on ${table}: ${JSON.stringify(s ?? null)}`);
    const [n] = await x.query<{ n: number }>(`select count(*)::int n from public."${table}"`);
    rows[table] = n!.n;
    if (opts.requireEmpty && n!.n !== 0) throw new Error(`${table} is not empty (${n!.n} rows)`);
  }
  return { ...(await tableCount(x)), rows, keys: keys.length };
}

/** Data only 0137 allows, anywhere: why a rollback must refuse (null when there is none). */
export async function data0137(x: Exec): Promise<string | null> {
  const found: string[] = [];
  const p = await present(x);
  for (const t of NEW_TABLES) {
    if (!p.rels.includes(t)) continue;
    const [n] = await x.query<{ n: number }>(`select count(*)::int n from public."${t}"`);
    if (n!.n) found.push(`${t}: ${n!.n} rows`);
  }
  const [h] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_calc_input_history where entity = 'f-decision'`);
  if (h!.n) found.push(`f-decision input history: ${h!.n}`);
  const [k] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_config_settings where setting_key in (${lit(NEW_KEYS)})`);
  if (k!.n) found.push(`settings using 0137's keys: ${k!.n}`);
  const [w] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_calc_adjustments where kind = 'recovery-write-off'`);
  if (w!.n) found.push(`recovery write-off adjustments: ${w!.n}`);
  const [orphan] = await x.query<{ n: number }>(`select count(*)::int n from public.testimonials where employee_id is null`);
  if (orphan!.n) found.push(`testimonials of a deleted employee: ${orphan!.n}`);
  if (p.nameColumn) {
    const [renamed] = await x.query<{ n: number }>(`select count(*)::int n from public.testimonials t join public.employees e on e.id = t.employee_id where t.employee_name is distinct from e.name`);
    if (renamed!.n) found.push(`testimonials whose kept name differs from their employee's: ${renamed!.n}`);
  }
  return found.length ? found.join("; ") : null;
}

/** Taken FIRST in a commit transaction (before any query fixes the snapshot): writes to the decisive tables wait. */
export async function lockFor(x: Exec, step: "apply" | "rollback") {
  const base = ["incentive_config_settings", "incentive_config_versions", "incentive_calc_input_history", "incentive_calc_adjustments", "testimonials"];
  const tables = step === "apply" ? base : [...NEW_TABLES, ...base];
  await x.exec(`LOCK TABLE ${tables.map((t) => `public."${t}"`).join(", ")} IN EXCLUSIVE MODE`);
}
const xid = async (x: Exec) => (await x.query<{ id: string }>(`select txid_current()::text id`))[0]!.id;

/* ── apply ───────────────────────────────────────────────────────────── */

export async function preApply(x: Exec, e: Expect, ref: Reference) {
  if (e.role) await checkRole(x);
  let ledger: string[] = [];
  if (e.ledger) {
    ledger = await ledgerRows(x);
    if (ledger.length !== e.ledger.before || new Set(ledger).size !== ledger.length) throw new Error(`ledger has ${ledger.length} rows; expected ${e.ledger.before} without duplicates`);
    if (ledger.at(-1) !== FILES.m0136) throw new Error(`last ledger row is ${ledger.at(-1)}; ${FILES.m0136} must be last`);
    if (ledger.some((f) => f >= "0137")) throw new Error("0137 (or a later file) is already recorded in the ledger");
  }
  const t = await tableCount(x);
  if (t.n !== e.tables.before || t.rls !== t.n) throw new Error(`expected ${e.tables.before} public tables all with RLS, found ${t.n} (${t.rls} with RLS)`);
  const p = await present(x);
  if (p.rels.length || p.fns.length || p.triggers || p.nameColumn) throw new Error(`0137's objects already (partly) exist — the state is ambiguous: ${JSON.stringify(p)}`);
  const [voids] = await x.query<{ ok: boolean }>(`select to_regclass('public.incentive_calc_period_voids') is not null ok`);
  if (!voids!.ok) throw new Error("0136 isn't applied (incentive_calc_period_voids is missing)");
  await assert0136(x, ref);
  const [k] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_config_settings where setting_key in (${lit(NEW_KEYS)})`);
  if (k!.n) throw new Error(`${k!.n} settings already use 0137's keys`);
  return { ledger, tables: t };
}

export async function applyIn(x: Exec, migration: string, e: Expect, ref: Reference) {
  await lockFor(x, "apply");
  const pre = await preApply(x, e, ref);
  const dataBefore = await dataFingerprints(x);
  const catBefore = await catalogue(x);
  const restBefore = await testimonialsRest(x);
  const id = await xid(x);
  await x.exec(migration);
  if ((await xid(x)) !== id) throw new Error("the migration text ended the transaction (COMMIT / ROLLBACK inside it)");
  if (e.ledger) await x.query(`insert into public.__schema_applied (filename) values ($1)`, [FILES.migration]);
  const dataAfter = await dataFingerprints(x);
  const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((t) => dataBefore[t] !== dataAfter[t]);
  if (changed.length) throw new Error(`existing data changed in: ${changed.join(", ")}`);
  if ((await catalogue(x)) !== catBefore) throw new Error("an existing relation, column, constraint, index, policy, trigger or function changed beyond 0137's own");
  if ((await testimonialsRest(x)) !== restBefore) throw new Error("testimonials changed beyond its employee link and kept name");
  if (e.ledger) {
    const after = await ledgerRows(x);
    const added = after.filter((f) => !pre.ledger.includes(f));
    if (after.length !== e.ledger.after || added.join() !== FILES.migration) throw new Error(`ledger change unexpected: ${after.length} rows (+${added.join(",")})`);
  }
  const n = await assert0137(x, ref);
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
  const why = await data0137(x);
  if (why) throw new Error(`rollback refused: data only 0137 allows exists (${why})`);
  const n = await assert0137(x, ref);
  if (n.n !== e.tables.after || n.rls !== n.n) throw new Error(`expected ${e.tables.after} public tables all with RLS, found ${n.n} (${n.rls})`);
  return { ledger };
}

export async function rollbackIn(x: Exec, rollback: string, e: Expect, ref: Reference) {
  await lockFor(x, "rollback");
  const pre = await preRollback(x, e, ref);
  const dataBefore = await dataFingerprints(x);
  const catBefore = await catalogue(x);
  const restBefore = await testimonialsRest(x);
  const id = await xid(x);
  await x.exec(rollback);
  if ((await xid(x)) !== id) throw new Error("the rollback text ended the transaction (COMMIT / ROLLBACK inside it)");
  if (e.ledger) await x.query(`delete from public.__schema_applied where filename = $1`, [FILES.migration]);
  const dataAfter = await dataFingerprints(x);
  const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((t) => dataBefore[t] !== dataAfter[t]);
  if (changed.length) throw new Error(`existing data changed in: ${changed.join(", ")}`);
  if ((await catalogue(x)) !== catBefore) throw new Error("an existing relation, column, constraint, index, policy, trigger or function changed beyond 0137's own");
  if ((await testimonialsRest(x)) !== restBefore) throw new Error("testimonials changed beyond its employee link and kept name");
  const p = await present(x);
  if (p.rels.length || p.fns.length || p.triggers || p.nameColumn) throw new Error(`0137's objects remain: ${JSON.stringify(p)}`);
  await assert0136(x, ref);
  if (e.ledger) {
    const after = await ledgerRows(x);
    if (after.length !== e.ledger.before || after.includes(FILES.migration) || pre.ledger.filter((f) => f !== FILES.migration).join() !== after.join()) throw new Error(`ledger change unexpected: ${after.length} rows`);
  }
  const t = await tableCount(x);
  if (t.n !== e.tables.before || t.rls !== t.n) throw new Error(`expected ${e.tables.before} public tables all with RLS, found ${t.n} (${t.rls})`);
  return { tablesFingerprinted: Object.keys(dataBefore).length, tables: t.n };
}

/* ── verification (read-only) ─────────────────────────────────────────── */

export async function verifyApplied(x: Exec, e: Expect, ref: Reference, opts: { requireEmpty: boolean }) {
  const out: { ok: boolean; check: string }[] = [];
  const ok = (cond: boolean, check: string) => out.push({ ok: cond, check });
  if (e.ledger) {
    const ledger = await ledgerRows(x);
    ok(ledger.length === e.ledger.after && new Set(ledger).size === ledger.length && ledger.at(-1) === FILES.migration && ledger.includes(FILES.m0136), `ledger ${ledger.length} rows, last ${ledger.at(-1)}`);
  }
  try {
    const n = await assert0137(x, ref, opts);
    ok(true, `0137's tables, columns, constraints, indexes, triggers, functions (${n.keys} settings keys), testimonials' employee link and security exactly as pinned; rows ${JSON.stringify(n.rows)}`);
    ok(n.n === e.tables.after && n.rls === n.n, `${n.n} public tables, ${n.rls} with RLS`);
  } catch (err) {
    ok(false, (err as Error).message);
  }
  return out;
}

export async function verifyRolledBack(x: Exec, e: Expect, ref: Reference) {
  const out: { ok: boolean; check: string }[] = [];
  const ok = (cond: boolean, check: string) => out.push({ ok: cond, check });
  const p = await present(x);
  ok(!p.rels.length && !p.fns.length && !p.triggers && !p.nameColumn, `0137's objects absent (${JSON.stringify(p)})`);
  try {
    await assert0136(x, ref);
    ok(true, "0136's settings list and entity check, 0132's adjustment checks and testimonials' 0068 employee link exactly restored");
  } catch (err) {
    ok(false, (err as Error).message);
  }
  if (e.ledger) {
    const ledger = await ledgerRows(x);
    ok(ledger.length === e.ledger.before && !ledger.includes(FILES.migration) && ledger.at(-1) === FILES.m0136, `ledger ${ledger.length} rows, last ${ledger.at(-1)}`);
  }
  const t = await tableCount(x);
  ok(t.n === e.tables.before && t.rls === t.n, `${t.n} public tables, ${t.rls} with RLS`);
  return out;
}
