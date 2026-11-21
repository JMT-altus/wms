import * as m137 from "../incentive-0137/core";
import { assertProduction, canonicalBytes, checkRole, fingerprintOf, ledgerRows, lit, pinned, sha256, tableCount, type Exec } from "../incentive-0137/core";

/**
 * Migration 0138 (Category F: email and letterhead testimonials, F.4 appreciation) — the SAFETY LOGIC of its preflight,
 * apply, rollback and verification runners, apart from any connection so it is proven on an in-memory PGlite database
 * (tests/integration/incentive-0138-runners.db.test.ts). It reuses the reviewed 0137 primitives (canonical-LF pinning,
 * the production fingerprint, role / ledger / table checks, the data fingerprints and catalogue of everything OUTSIDE
 * Category F's own objects, and 0137's pinned canonical listing — which proves the database is EXACTLY at 0137 before
 * applying, and exactly back at 0137 after a rollback).
 *
 * 0138 adds no table. It changes only Category F's own objects:
 *   incentive_f_submissions  + claimed_kind; claimed_rating optional (required for a Google review); rating check replaced
 *   incentive_f_decisions    + testimonial_kind, appreciated_employee_ids / _names, evidence_key, confirmed_from_customer /
 *                              confirmed_type / confirmed_genuine; verify check replaced (NULL-safe); three new checks;
 *                              unique index incentive_f_decisions_evidence_key_uq; insert-check function replaced (0137's
 *                              body + one rule)
 * Existing rows keep their values; only the new columns are filled with their defaults (existing Category F records are
 * Google reviews). Every function throws on anything unexpected; the caller's transaction then rolls everything back.
 */
export { assertProduction, canonicalBytes, fingerprintOf, pinned, sha256, ledgerRows, lit, tableCount, checkRole, type Exec };

export const FILES = {
  migration: "0138_incentive_category_f_testimonials.sql",
  rollback: "0138_incentive_category_f_testimonials.rollback.sql",
  m0137: m137.FILES.migration,
  m0136: m137.FILES.m0136,
} as const;
export const PINS = {
  migration: "abdb88095cd496fd5bae2ccf16a708c4e7c4d514e91e650080fd83ac658f7f3b",
  rollback: "7f805599dbf217d8b38d84fcfc15984fb168001bba6ba3fee1338ca658c8fddf",
  /** As applied to production on 2026-11-19 (its key list and listing are 0138's starting point). */
  m0137: m137.PINS.migration,
  m0136: m137.PINS.m0136,
} as const;
export const PRODUCTION_FINGERPRINT = m137.PRODUCTION_FINGERPRINT;

export interface Expect {
  ledger: { before: number; after: number } | null;
  tables: number;
  role: boolean;
}
/** Production after 0137 (verified read-only on 2026-11-19): ledger 150, 170 public tables. 0138 adds no table. */
export const PRODUCTION: Expect = { ledger: { before: 150, after: 151 }, tables: 170, role: true };

export const F_TABLES = m137.NEW_TABLES;
export const NEW_COLS: Record<string, readonly string[]> = {
  incentive_f_submissions: ["claimed_kind"],
  incentive_f_decisions: ["testimonial_kind", "appreciated_employee_ids", "appreciated_employee_names", "evidence_key", "confirmed_from_customer", "confirmed_type", "confirmed_genuine"],
};
export const EXPECT_COLS_0138: Record<(typeof F_TABLES)[number], string> = {
  incentive_f_reviews: m137.EXPECT_COLS.incentive_f_reviews,
  incentive_f_submissions: `${m137.EXPECT_COLS.incentive_f_submissions},claimed_kind`,
  incentive_f_decisions: `${m137.EXPECT_COLS.incentive_f_decisions},testimonial_kind,appreciated_employee_ids,appreciated_employee_names,evidence_key,confirmed_from_customer,confirmed_type,confirmed_genuine`,
  incentive_f_writeoffs: m137.EXPECT_COLS.incentive_f_writeoffs,
};
export const NEW_CONSTRAINTS = ["incentive_f_decisions_testimonial_kind_check", "incentive_f_decisions_appreciated_check", "incentive_f_decisions_evidence_key_check"] as const;
export const NEW_INDEX = "incentive_f_decisions_evidence_key_uq";
export const RULE_0138 = "An email or letterhead testimonial is verified against its customer (Customer Master)";
/**
 * sha256 of canonical0138's listing of Category F's objects AFTER 0138, taken on PGlite (Postgres 17). Unlike 0137's
 * listing it numbers columns by their ORDER among live columns, not by attnum: Postgres never reuses a dropped column's
 * attnum, so after a rollback a re-applied 0138 must still match.
 */
export const CANON_0138 = "edad20c56401a283081a01ff45e38908f85d17eec570b4829f886d1cf33fc9d6";
/** 0137's canonical listing of Category F's objects, with each column numbered by its position among live columns. */
export async function canonical0138(x: Exec): Promise<string> {
  const listing = JSON.parse(await m137.canonical0137(x)) as { cols: { t: string; n: number }[] } & Record<string, unknown>;
  const pos = new Map<string, number>();
  listing.cols = listing.cols.map((c) => {
    const k = (pos.get(c.t) ?? 0) + 1;
    pos.set(c.t, k);
    return { ...c, n: k };
  });
  return JSON.stringify(listing);
}

/* ── files ── */
export type Reference = m137.Reference;
export const reference = (m0136: string, m0137: string): Reference => m137.reference(m0136, m0137);

/* ── reads ── */
/** Which of 0138's own objects exist (columns, constraints, the index, the rule in the insert check). */
export async function present0138(x: Exec) {
  const cols = await x.query<{ t: string; c: string }>(
    `select table_name t, column_name c from information_schema.columns where table_schema = 'public' and ((table_name = 'incentive_f_submissions' and column_name in (${lit(NEW_COLS.incentive_f_submissions!)})) or (table_name = 'incentive_f_decisions' and column_name in (${lit(NEW_COLS.incentive_f_decisions!)}))) order by 1, 2`,
  );
  const [con] = await x.query<{ n: number }>(`select count(*)::int n from pg_constraint where conname in (${lit(NEW_CONSTRAINTS)})`);
  const [idx] = await x.query<{ n: number }>(`select count(*)::int n from pg_indexes where schemaname = 'public' and indexname = $1`, [NEW_INDEX]);
  const [fn] = await x.query<{ n: number }>(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'incentive_f_decisions_check' and prosrc like '%' || $1 || '%'`, [RULE_0138]);
  return { columns: cols.map((r) => `${r.t}.${r.c}`), constraints: con!.n, index: idx!.n, rule: fn!.n };
}
const none = (p: Awaited<ReturnType<typeof present0138>>) => !p.columns.length && !p.constraints && !p.index && !p.rule;

/** Rows 0138's stricter checks would refuse (the migration would then fail): reported BEFORE anything runs. */
export async function incompatible(x: Exec): Promise<string | null> {
  const found: string[] = [];
  const [r] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_f_decisions where kind = 'verify' and (rating is null or rating not between 1 and 5 or published_on is null or review_month is distinct from date_trunc('month', published_on)::date)`);
  if (r!.n) found.push(`${r!.n} Google verification(s) without a valid rating or date (0137's check let a NULL through)`);
  const [s] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_f_submissions where claimed_rating is null or claimed_rating not between 1 and 5`);
  if (s!.n) found.push(`${s!.n} submission(s) without a valid claimed rating`);
  return found.length ? found.join("; ") : null;
}

/** Category F's rows, WITHOUT 0138's new columns — identical before and after 0138 (and after its rollback). */
export async function fFingerprints(x: Exec): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of F_TABLES) {
    const drop = (NEW_COLS[t] ?? []).map((c) => ` - '${c}'`).join("");
    const row = `(to_jsonb(t)${drop})::text`;
    const [r] = await x.query<{ n: string; h: string }>(`select count(*)::text n, coalesce(md5(string_agg(md5(${row}), '' order by md5(${row}))), '') h from public."${t}" t`);
    out[t] = `${r!.n}:${r!.h}`;
  }
  return out;
}
/** What 0138's new columns hold for EXISTING rows right after it ran: the documented defaults only. */
export async function defaultsOnly(x: Exec): Promise<string | null> {
  const [s] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_f_submissions where claimed_kind <> 'google_review'`);
  const [d] = await x.query<{ n: number }>(
    `select count(*)::int n from public.incentive_f_decisions where testimonial_kind is distinct from 'google_review' or cardinality(appreciated_employee_ids) > 0 or cardinality(appreciated_employee_names) > 0 or evidence_key is not null or confirmed_from_customer or confirmed_type or confirmed_genuine`,
  );
  return s!.n || d!.n ? `${s!.n} submission(s) and ${d!.n} decision(s) hold more than 0138's defaults` : null;
}
/** The definitions 0138 must NOT change outside Category F (0137's widened checks, testimonials' named check). */
export async function outsideConstraints(x: Exec): Promise<string> {
  const names = [...m137.CHANGED_CONSTRAINTS, "testimonials_employee_named_check"];
  return JSON.stringify(await x.query(`select conname, pg_get_constraintdef(oid) d, convalidated v from pg_constraint where conname in (${lit(names)}) order by 1`));
}
async function security(x: Exec) {
  for (const table of F_TABLES) {
    const [s] = await x.query<{ rls: boolean; f: boolean; pol: number; rest: boolean | null }>(
      `select c.relrowsecurity rls, c.relforcerowsecurity f, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol,
         (select bool_or(has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) from pg_roles r where r.rolname in ('anon', 'authenticated')) rest
       from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = $1`,
      [table],
    );
    if (!s || !s.rls || s.f || s.pol !== 0 || s.rest) throw new Error(`security unexpected on ${table}: ${JSON.stringify(s ?? null)}`);
  }
}

/** The database is EXACTLY at 0137 (0137's pinned listing and checks) with none of 0138's objects. */
export async function assertAt0137(x: Exec, ref: Reference) {
  const p = await present0138(x);
  if (!none(p)) throw new Error(`0138's objects already (partly) exist — the state is ambiguous: ${JSON.stringify(p)}`);
  await m137.assert0137(x, ref, { requireEmpty: false });
}

/** Every 0138 object exactly as pinned; existing rows hold only the defaults when `defaults` is asked. */
export async function assert0138(x: Exec, ref: Reference, opts: { defaults: boolean } = { defaults: false }) {
  for (const [t, want] of Object.entries(EXPECT_COLS_0138)) {
    const got = (await x.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).map((r) => r.c).join(",");
    if (got !== want) throw new Error(`${t} columns unexpected: ${got || "(missing)"}`);
  }
  const p = await present0138(x);
  if (p.constraints !== NEW_CONSTRAINTS.length || p.index !== 1 || p.rule !== 1) throw new Error(`0138's checks / index / insert rule unexpected: ${JSON.stringify(p)}`);
  const unvalidated = await x.query<{ conname: string }>(`select conname from pg_constraint where conrelid in ('public.incentive_f_decisions'::regclass, 'public.incentive_f_submissions'::regclass) and not convalidated`);
  if (unvalidated.length) throw new Error(`not validated: ${unvalidated.map((r) => r.conname).join(", ")}`);
  const canon = sha256(await canonical0138(x));
  if (canon !== CANON_0138) throw new Error(`Category F's objects differ from the pinned 0138 listing (canonical sha256 ${canon})`);
  await security(x);
  // Everything else 0137 established is unchanged (settings list, entity, adjustments, testimonials' link).
  const d = await x.query<{ conname: string; d: string; v: boolean }>(`select conname, pg_get_constraintdef(oid) d, convalidated v from pg_constraint where conname in (${lit(m137.CHANGED_CONSTRAINTS)})`);
  const keys = [...(d.find((r) => r.conname === "incentive_config_settings_key_check")?.d ?? "").matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'::text/g)].map((m) => m[1]!).sort();
  if (keys.join() !== ref.keys0137.join()) throw new Error(`settings key check isn't 0137's (${keys.length} keys)`);
  if (d.find((r) => r.conname === "incentive_calc_input_history_entity_check")?.d !== m137.ENTITY_0137) throw new Error("input-history entity check isn't 0137's");
  if (opts.defaults) {
    const why = await defaultsOnly(x);
    if (why) throw new Error(why);
  }
  return { ...(await tableCount(x)) };
}

/** Data only 0138 allows — why a rollback must refuse (null when there is none). Mirrors the rollback SQL's own refusal. */
export async function data0138(x: Exec): Promise<string | null> {
  const p = await present0138(x);
  if (!p.columns.length) return null;
  const found: string[] = [];
  const [s] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_f_submissions where claimed_kind <> 'google_review' or claimed_rating is null`);
  if (s!.n) found.push(`email / letterhead (or rating-less) submissions: ${s!.n}`);
  const [d] = await x.query<{ n: number }>(
    `select count(*)::int n from public.incentive_f_decisions where testimonial_kind in ('email', 'letterhead') or cardinality(appreciated_employee_ids) > 0 or evidence_key is not null or confirmed_from_customer or confirmed_type or confirmed_genuine`,
  );
  if (d!.n) found.push(`decisions with an email / letterhead type, an appreciation (F.4), an evidence identity or a verifier finding: ${d!.n}`);
  return found.length ? found.join("; ") : null;
}

/** Taken FIRST in a commit transaction: writes to Category F's tables wait (reads continue). */
export async function lockFor(x: Exec) {
  await x.exec(`LOCK TABLE ${[...F_TABLES, "incentive_config_settings", "incentive_config_versions"].map((t) => `public."${t}"`).join(", ")} IN EXCLUSIVE MODE`);
}
const xid = async (x: Exec) => (await x.query<{ id: string }>(`select txid_current()::text id`))[0]!.id;

/* ── preflight / apply ── */
export async function preApply(x: Exec, e: Expect, ref: Reference) {
  if (e.role) await checkRole(x);
  let ledger: string[] = [];
  if (e.ledger) {
    ledger = await ledgerRows(x);
    if (ledger.length !== e.ledger.before || new Set(ledger).size !== ledger.length) throw new Error(`ledger has ${ledger.length} rows; expected ${e.ledger.before} without duplicates`);
    if (ledger.at(-1) !== FILES.m0137) throw new Error(`last ledger row is ${ledger.at(-1)}; ${FILES.m0137} must be last`);
    if (ledger.some((f) => f >= "0138")) throw new Error("0138 (or a later file) is already recorded in the ledger");
  }
  const t = await tableCount(x);
  if (t.n !== e.tables || t.rls !== t.n) throw new Error(`expected ${e.tables} public tables all with RLS, found ${t.n} (${t.rls} with RLS)`);
  await assertAt0137(x, ref);
  const bad = await incompatible(x);
  if (bad) throw new Error(`existing Category F data 0138's checks would refuse: ${bad}`);
  const rows: Record<string, number> = {};
  for (const tb of F_TABLES) rows[tb] = (await x.query<{ n: number }>(`select count(*)::int n from public."${tb}"`))[0]!.n;
  return { ledger, tables: t, rows };
}

export async function applyIn(x: Exec, migration: string, e: Expect, ref: Reference) {
  await lockFor(x);
  const pre = await preApply(x, e, ref);
  const dataBefore = await m137.dataFingerprints(x);
  const fBefore = await fFingerprints(x);
  const catBefore = await m137.catalogue(x);
  const restBefore = await m137.testimonialsRest(x);
  const outBefore = await outsideConstraints(x);
  const id = await xid(x);
  await x.exec(migration);
  if ((await xid(x)) !== id) throw new Error("the migration text ended the transaction (COMMIT / ROLLBACK inside it)");
  if (e.ledger) await x.query(`insert into public.__schema_applied (filename) values ($1)`, [FILES.migration]);
  const dataAfter = await m137.dataFingerprints(x);
  const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((k) => dataBefore[k] !== dataAfter[k]);
  if (changed.length) throw new Error(`existing data changed in: ${changed.join(", ")}`);
  const fAfter = await fFingerprints(x);
  const fChanged = F_TABLES.filter((k) => fBefore[k] !== fAfter[k]);
  if (fChanged.length) throw new Error(`existing Category F rows changed beyond 0138's new columns in: ${fChanged.join(", ")}`);
  if ((await m137.catalogue(x)) !== catBefore) throw new Error("an object outside Category F changed");
  if ((await m137.testimonialsRest(x)) !== restBefore) throw new Error("testimonials changed");
  if ((await outsideConstraints(x)) !== outBefore) throw new Error("a check 0137 established outside Category F changed");
  await assert0138(x, ref, { defaults: true });
  if (e.ledger) {
    const after = await ledgerRows(x);
    const added = after.filter((f) => !pre.ledger.includes(f));
    if (after.length !== e.ledger.after || added.join() !== FILES.migration) throw new Error(`ledger change unexpected: ${after.length} rows (+${added.join(",")})`);
  }
  const t = await tableCount(x);
  if (t.n !== e.tables || t.rls !== t.n) throw new Error(`expected ${e.tables} public tables all with RLS, found ${t.n} (${t.rls})`);
  return { tablesFingerprinted: Object.keys(dataBefore).length, fRows: pre.rows, tables: t.n };
}

/* ── rollback ── */
export async function preRollback(x: Exec, e: Expect, ref: Reference) {
  if (e.role) await checkRole(x);
  let ledger: string[] = [];
  if (e.ledger) {
    ledger = await ledgerRows(x);
    if (ledger.length !== e.ledger.after || new Set(ledger).size !== ledger.length) throw new Error(`ledger has ${ledger.length} rows; expected ${e.ledger.after} without duplicates`);
    if (ledger.at(-1) !== FILES.migration) throw new Error(`last ledger row is ${ledger.at(-1)}; ${FILES.migration} must be last`);
  }
  const why = await data0138(x);
  if (why) throw new Error(`rollback refused: data only 0138 allows exists (${why})`);
  await assert0138(x, ref);
  const t = await tableCount(x);
  if (t.n !== e.tables || t.rls !== t.n) throw new Error(`expected ${e.tables} public tables all with RLS, found ${t.n} (${t.rls})`);
  return { ledger };
}

export async function rollbackIn(x: Exec, rollback: string, e: Expect, ref: Reference) {
  await lockFor(x);
  const pre = await preRollback(x, e, ref);
  const dataBefore = await m137.dataFingerprints(x);
  const fBefore = await fFingerprints(x);
  const catBefore = await m137.catalogue(x);
  const restBefore = await m137.testimonialsRest(x);
  const outBefore = await outsideConstraints(x);
  const id = await xid(x);
  await x.exec(rollback);
  if ((await xid(x)) !== id) throw new Error("the rollback text ended the transaction (COMMIT / ROLLBACK inside it)");
  if (e.ledger) await x.query(`delete from public.__schema_applied where filename = $1`, [FILES.migration]);
  const dataAfter = await m137.dataFingerprints(x);
  const changed = Object.keys({ ...dataBefore, ...dataAfter }).filter((k) => dataBefore[k] !== dataAfter[k]);
  if (changed.length) throw new Error(`existing data changed in: ${changed.join(", ")}`);
  const fAfter = await fFingerprints(x);
  const fChanged = F_TABLES.filter((k) => fBefore[k] !== fAfter[k]);
  if (fChanged.length) throw new Error(`Category F rows changed in: ${fChanged.join(", ")}`);
  if ((await m137.catalogue(x)) !== catBefore) throw new Error("an object outside Category F changed");
  if ((await m137.testimonialsRest(x)) !== restBefore) throw new Error("testimonials changed");
  if ((await outsideConstraints(x)) !== outBefore) throw new Error("a check 0137 established outside Category F changed");
  await assertAt0137(x, ref); // exactly 0137 again (its pinned listing)
  if (e.ledger) {
    const after = await ledgerRows(x);
    if (after.length !== e.ledger.before || after.includes(FILES.migration) || pre.ledger.filter((f) => f !== FILES.migration).join() !== after.join()) throw new Error(`ledger change unexpected: ${after.length} rows`);
  }
  return { tables: (await tableCount(x)).n };
}

/* ── read-only verification ── */
export async function verifyApplied(x: Exec, e: Expect, ref: Reference) {
  const out: { ok: boolean; check: string }[] = [];
  const ok = (c: boolean, check: string) => out.push({ ok: c, check });
  if (e.ledger) {
    const ledger = await ledgerRows(x);
    ok(ledger.length === e.ledger.after && new Set(ledger).size === ledger.length && ledger.at(-1) === FILES.migration && ledger.filter((f) => f === FILES.migration).length === 1, `ledger ${ledger.length} rows, last ${ledger.at(-1)}`);
  }
  try {
    const t = await assert0138(x, ref);
    ok(true, "Category F's columns, checks, index, insert rule and security exactly as pinned; 0137's other checks unchanged");
    ok(t.n === e.tables && t.rls === t.n, `${t.n} public tables, ${t.rls} with RLS`);
  } catch (err) {
    ok(false, (err as Error).message);
  }
  const g = await x.query<{ s: number; d: number }>(`select (select count(*)::int from public.incentive_f_submissions where claimed_kind = 'google_review') s, (select count(*)::int from public.incentive_f_decisions where testimonial_kind = 'google_review') d`);
  ok(true, `Google records: ${g[0]!.s} submissions, ${g[0]!.d} decisions typed google_review`);
  const why = await data0138(x);
  ok(true, why ? `rollback NOT possible now: ${why}` : "rollback still possible (no data only 0138 allows)");
  return out;
}
export async function verifyRolledBack(x: Exec, e: Expect, ref: Reference) {
  const out: { ok: boolean; check: string }[] = [];
  const ok = (c: boolean, check: string) => out.push({ ok: c, check });
  try {
    await assertAt0137(x, ref);
    ok(true, "exactly 0137 again (0137's pinned listing); none of 0138's objects");
  } catch (err) {
    ok(false, (err as Error).message);
  }
  if (e.ledger) {
    const ledger = await ledgerRows(x);
    ok(ledger.length === e.ledger.before && !ledger.includes(FILES.migration) && ledger.at(-1) === FILES.m0137, `ledger ${ledger.length} rows, last ${ledger.at(-1)}`);
  }
  return out;
}
