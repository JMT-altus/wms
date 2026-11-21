import * as m137 from "../incentive-0137/core";
import * as m138 from "../incentive-0138/core";
import { checkRole, ledgerRows, lit, sha256, tableCount, type Exec } from "../incentive-0137/core";

/**
 * Migration 0139 (Category F: the email / letterhead identity and the write-off input history) — the SAFETY LOGIC of its
 * preflight, apply, rollback and verification runners, apart from any connection so it is proven on PGlite
 * (tests/integration/incentive-0139-runners.db.test.ts) and, when a throwaway server is provided, on real PostgreSQL
 * (tests/integration/incentive-category-f-concurrency.pg.test.ts). It reuses the reviewed 0137 / 0138 primitives:
 * canonical-LF pinning, the production fingerprint, role / ledger / table checks, the data fingerprints and catalogue of
 * everything OUTSIDE Category F's own objects and the checks 0137 widened, and 0138's pinned listing — which proves the
 * database is EXACTLY at 0138 before applying, and exactly back at 0138 after a rollback.
 *
 * 0139 adds no table. It changes:
 *   incentive_f_decisions         + evidence_message_id, evidence_fingerprint (NULL for every existing row);
 *                                   + incentive_f_decisions_identity_check; + unique indexes …_message_id_uq, …_fingerprint_uq
 *   incentive_calc_input_history  entity check: 0137's list + 'f-writeoff'
 * Every function throws on anything unexpected; the caller's transaction then rolls everything back.
 */
export { assertProduction, canonicalBytes, fingerprintOf, pinned, sha256, ledgerRows, lit, tableCount, checkRole, type Exec } from "../incentive-0137/core";

export const FILES = {
  migration: "0139_incentive_category_f_identity.sql",
  rollback: "0139_incentive_category_f_identity.rollback.sql",
  m0138: m138.FILES.migration,
  m0137: m138.FILES.m0137,
  m0136: m138.FILES.m0136,
} as const;
export const PINS = {
  migration: "b83d2ffe88186a7720c0d7ed52b0274b41496d6ea01d3a085451b85bb74511f2",
  rollback: "67ea3e6ddf365a1e4100d83ee0d0dc31554f80d0ce6a7caa1967b6b1f7d88513",
  m0138: m138.PINS.migration,
  m0137: m138.PINS.m0137,
  m0136: m138.PINS.m0136,
} as const;
export const PRODUCTION_FINGERPRINT = m137.PRODUCTION_FINGERPRINT;
export type Expect = m138.Expect;
/** Production after 0138 (expected: 0138 applied through its own runner, ledger 151) — 0139 adds no table. */
export const PRODUCTION: Expect = { ledger: { before: 151, after: 152 }, tables: 170, role: true };

export const F_TABLES = m137.NEW_TABLES;
export const NEW_COLS = ["evidence_message_id", "evidence_fingerprint"] as const;
export const EXPECT_COLS_0139: Record<(typeof F_TABLES)[number], string> = { ...m138.EXPECT_COLS_0138, incentive_f_decisions: `${m138.EXPECT_COLS_0138.incentive_f_decisions},${NEW_COLS.join(",")}` };
export const NEW_CONSTRAINT = "incentive_f_decisions_identity_check";
export const NEW_INDEXES = ["incentive_f_decisions_fingerprint_uq", "incentive_f_decisions_message_id_uq"] as const;
export const ENTITY_CHECK = "incentive_calc_input_history_entity_check";
/** The input-history entity check after 0139: 0137's list + 'f-writeoff' (as pg_get_constraintdef prints it). */
export const ENTITY_0139 = m137.ENTITY_0137.replace("'f-decision'::text])", "'f-decision'::text, 'f-writeoff'::text])");
/** sha256 of the position-numbered listing of Category F's objects AFTER 0139 (canonical0138's listing), taken on PGlite. */
export const CANON_0139 = "0eea6a84e4bf63784ffe8b0c1e40ad170ad9817f88c71e647bbd48f5abd7decd";
export const canonical0139 = m138.canonical0138;

export type Reference = m138.Reference;
export const reference = m138.reference;

/* ── reads ── */
/** Which of 0139's own objects exist (columns, the identity check, the two unique indexes, the 'f-writeoff' entity). */
export async function present0139(x: Exec) {
  const cols = await x.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = 'incentive_f_decisions' and column_name in (${lit(NEW_COLS)}) order by 1`);
  const [con] = await x.query<{ n: number }>(`select count(*)::int n from pg_constraint where conname = $1`, [NEW_CONSTRAINT]);
  const [idx] = await x.query<{ n: number }>(`select count(*)::int n from pg_indexes where schemaname = 'public' and indexname in (${lit(NEW_INDEXES)})`);
  const [ent] = await x.query<{ n: number }>(`select count(*)::int n from pg_constraint where conname = $1 and pg_get_constraintdef(oid) like '%f-writeoff%'`, [ENTITY_CHECK]);
  return { columns: cols.map((r) => r.c), constraint: con!.n, indexes: idx!.n, entity: ent!.n };
}
const none = (p: Awaited<ReturnType<typeof present0139>>) => !p.columns.length && !p.constraint && !p.indexes && !p.entity;

/** Rows 0139 would refuse (it then fails): email / letterhead verifications, which have no derived identity yet. */
export async function incompatible(x: Exec): Promise<string | null> {
  const [r] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_f_decisions where kind = 'verify' and testimonial_kind in ('email', 'letterhead')`);
  return r!.n ? `${r!.n} email / letterhead verification(s) without a derived identity` : null;
}

/** Category F's rows WITHOUT 0138's and 0139's new columns — identical before and after 0139 (and after its rollback). */
export async function fFingerprints(x: Exec): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of F_TABLES) {
    const drop = [...(m138.NEW_COLS[t] ?? []), ...(t === "incentive_f_decisions" ? NEW_COLS : [])].map((c) => ` - '${c}'`).join("");
    const row = `(to_jsonb(t)${drop})::text`;
    const [r] = await x.query<{ n: string; h: string }>(`select count(*)::text n, coalesce(md5(string_agg(md5(${row}), '' order by md5(${row}))), '') h from public."${t}" t`);
    out[t] = `${r!.n}:${r!.h}`;
  }
  return out;
}
/** What 0139 adds holds nothing for EXISTING rows right after it ran. */
export async function defaultsOnly(x: Exec): Promise<string | null> {
  const [d] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_f_decisions where evidence_message_id is not null or evidence_fingerprint is not null`);
  const [h] = await x.query<{ n: number }>(`select count(*)::int n from public.incentive_calc_input_history where entity = 'f-writeoff'`);
  return d!.n || h!.n ? `${d!.n} decision(s) with an identity and ${h!.n} write-off history row(s) right after 0139` : null;
}
/** The checks 0137 widened and testimonials' named check — all but the input-history entity check, which 0139 changes. */
export async function outsideConstraints(x: Exec): Promise<string> {
  const names = [...m137.CHANGED_CONSTRAINTS.filter((c) => c !== ENTITY_CHECK), "testimonials_employee_named_check"];
  return JSON.stringify(await x.query(`select conname, pg_get_constraintdef(oid) d, convalidated v from pg_constraint where conname in (${lit(names)}) order by 1`));
}
async function security(x: Exec) {
  for (const table of [...F_TABLES, "incentive_calc_input_history"]) {
    const [s] = await x.query<{ rls: boolean; f: boolean; pol: number; rest: boolean | null }>(
      `select c.relrowsecurity rls, c.relforcerowsecurity f, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol,
         (select bool_or(has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) from pg_roles r where r.rolname in ('anon', 'authenticated')) rest
       from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = $1`,
      [table],
    );
    if (!s || !s.rls || s.f || s.pol !== 0 || s.rest) throw new Error(`security unexpected on ${table}: ${JSON.stringify(s ?? null)}`);
  }
}

/** The database is EXACTLY at 0138 (0138's pinned listing; 0137's entity list) with none of 0139's objects. */
export async function assertAt0138(x: Exec, ref: Reference) {
  const p = await present0139(x);
  if (!none(p)) throw new Error(`0139's objects already (partly) exist — the state is ambiguous: ${JSON.stringify(p)}`);
  await m138.assert0138(x, ref);
}

/** Every 0139 object exactly as pinned (and 0138's untouched); existing rows hold nothing new when `defaults` is asked. */
export async function assert0139(x: Exec, ref: Reference, opts: { defaults: boolean } = { defaults: false }) {
  for (const [t, want] of Object.entries(EXPECT_COLS_0139)) {
    const got = (await x.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).map((r) => r.c).join(",");
    if (got !== want) throw new Error(`${t} columns unexpected: ${got || "(missing)"}`);
  }
  const p = await present0139(x);
  if (p.constraint !== 1 || p.indexes !== NEW_INDEXES.length || p.entity !== 1) throw new Error(`0139's check / indexes / entity unexpected: ${JSON.stringify(p)}`);
  const p138 = await m138.present0138(x);
  if (p138.constraints !== m138.NEW_CONSTRAINTS.length || p138.index !== 1 || p138.rule !== 1) throw new Error(`0138's objects changed: ${JSON.stringify(p138)}`);
  const unvalidated = await x.query<{ conname: string }>(`select conname from pg_constraint where conrelid in ('public.incentive_f_decisions'::regclass, 'public.incentive_f_submissions'::regclass, 'public.incentive_calc_input_history'::regclass) and not convalidated`);
  if (unvalidated.length) throw new Error(`not validated: ${unvalidated.map((r) => r.conname).join(", ")}`);
  const canon = sha256(await canonical0139(x));
  if (canon !== CANON_0139) throw new Error(`Category F's objects differ from the pinned 0139 listing (canonical sha256 ${canon})`);
  await security(x);
  const d = await x.query<{ conname: string; d: string }>(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conname in (${lit(m137.CHANGED_CONSTRAINTS)})`);
  if (d.find((r) => r.conname === ENTITY_CHECK)?.d !== ENTITY_0139) throw new Error(`input-history entity check isn't 0139's: ${d.find((r) => r.conname === ENTITY_CHECK)?.d}`);
  const keys = [...(d.find((r) => r.conname === "incentive_config_settings_key_check")?.d ?? "").matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)'::text/g)].map((m) => m[1]!).sort();
  if (keys.join() !== ref.keys0137.join()) throw new Error(`settings key check isn't 0137's (${keys.length} keys)`);
  if (opts.defaults) {
    const why = await defaultsOnly(x);
    if (why) throw new Error(why);
  }
  return { ...(await tableCount(x)) };
}

/** Data only 0139 allows — why a rollback must refuse (null when there is none). Mirrors the rollback SQL's own refusal. */
export async function data0139(x: Exec): Promise<string | null> {
  const p = await present0139(x);
  if (!p.columns.length) return null;
  const why = await defaultsOnly(x);
  return why ? `email / letterhead identities or write-off history exist (${why})` : null;
}

/** Taken FIRST in a commit transaction: writes to Category F's tables, the input history and the configuration wait. */
export async function lockFor(x: Exec) {
  await x.exec(`LOCK TABLE ${[...F_TABLES, "incentive_calc_input_history", "incentive_config_settings", "incentive_config_versions"].map((t) => `public."${t}"`).join(", ")} IN EXCLUSIVE MODE`);
}
const xid = async (x: Exec) => (await x.query<{ id: string }>(`select txid_current()::text id`))[0]!.id;
const entityDef = async (x: Exec) => (await x.query<{ d: string; v: boolean }>(`select pg_get_constraintdef(oid) d, convalidated v from pg_constraint where conname = $1`, [ENTITY_CHECK]))[0];

/* ── preflight / apply ── */
export async function preApply(x: Exec, e: Expect, ref: Reference) {
  if (e.role) await checkRole(x);
  let ledger: string[] = [];
  if (e.ledger) {
    ledger = await ledgerRows(x);
    if (ledger.length !== e.ledger.before || new Set(ledger).size !== ledger.length) throw new Error(`ledger has ${ledger.length} rows; expected ${e.ledger.before} without duplicates`);
    if (ledger.at(-1) !== FILES.m0138) throw new Error(`last ledger row is ${ledger.at(-1)}; ${FILES.m0138} must be last`);
    if (ledger.some((f) => f >= "0139")) throw new Error("0139 (or a later file) is already recorded in the ledger");
  }
  const t = await tableCount(x);
  if (t.n !== e.tables || t.rls !== t.n) throw new Error(`expected ${e.tables} public tables all with RLS, found ${t.n} (${t.rls} with RLS)`);
  await assertAt0138(x, ref);
  const bad = await incompatible(x);
  if (bad) throw new Error(`existing Category F data 0139 would refuse: ${bad}`);
  const rows: Record<string, number> = {};
  for (const tb of [...F_TABLES, "incentive_calc_input_history"]) rows[tb] = (await x.query<{ n: number }>(`select count(*)::int n from public."${tb}"`))[0]!.n;
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
  if (fChanged.length) throw new Error(`existing Category F rows changed beyond 0139's new columns in: ${fChanged.join(", ")}`);
  if ((await m137.catalogue(x)) !== catBefore) throw new Error("an object outside Category F changed");
  if ((await m137.testimonialsRest(x)) !== restBefore) throw new Error("testimonials changed");
  if ((await outsideConstraints(x)) !== outBefore) throw new Error("a check 0137 established outside Category F changed");
  await assert0139(x, ref, { defaults: true });
  if (e.ledger) {
    const after = await ledgerRows(x);
    const added = after.filter((f) => !pre.ledger.includes(f));
    if (after.length !== e.ledger.after || added.join() !== FILES.migration) throw new Error(`ledger change unexpected: ${after.length} rows (+${added.join(",")})`);
  }
  const t = await tableCount(x);
  if (t.n !== e.tables || t.rls !== t.n) throw new Error(`expected ${e.tables} public tables all with RLS, found ${t.n} (${t.rls})`);
  return { tablesFingerprinted: Object.keys(dataBefore).length, rows: pre.rows, tables: t.n };
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
  const why = await data0139(x);
  if (why) throw new Error(`rollback refused: data only 0139 allows exists (${why})`);
  await assert0139(x, ref);
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
  const ent = await entityDef(x);
  if (!ent?.v || ent.d !== m137.ENTITY_0137) throw new Error(`input-history entity check isn't 0137's again: ${ent?.d}`);
  await assertAt0138(x, ref); // exactly 0138 again (its pinned listing)
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
    const t = await assert0139(x, ref);
    ok(true, "0139's columns, identity check, unique indexes and entity list exactly as pinned; 0138's objects and security unchanged");
    ok(t.n === e.tables && t.rls === t.n, `${t.n} public tables, ${t.rls} with RLS`);
  } catch (err) {
    ok(false, (err as Error).message);
  }
  const g = await x.query<{ d: number; h: number }>(`select (select count(*)::int from public.incentive_f_decisions) d, (select count(*)::int from public.incentive_calc_input_history where entity = 'f-decision') h`);
  ok(true, `Category F decisions preserved: ${g[0]!.d}; their input history: ${g[0]!.h} rows`);
  const why = await data0139(x);
  ok(true, why ? `rollback NOT possible now: ${why}` : "rollback still possible (no data only 0139 allows)");
  return out;
}
export async function verifyRolledBack(x: Exec, e: Expect, ref: Reference) {
  const out: { ok: boolean; check: string }[] = [];
  const ok = (c: boolean, check: string) => out.push({ ok: c, check });
  try {
    await assertAt0138(x, ref);
    ok(true, "exactly 0138 again (0138's pinned listing, 0137's entity list); none of 0139's objects");
  } catch (err) {
    ok(false, (err as Error).message);
  }
  if (e.ledger) {
    const ledger = await ledgerRows(x);
    ok(ledger.length === e.ledger.before && !ledger.includes(FILES.migration) && ledger.at(-1) === FILES.m0138, `ledger ${ledger.length} rows, last ${ledger.at(-1)}`);
  }
  return out;
}
