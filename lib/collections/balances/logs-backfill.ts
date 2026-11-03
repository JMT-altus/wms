/**
 * One-time clean-up: move the companies the Collection Tracker shows with no
 * balance (Debit and Credit both "—" or ₹0) into Collection Logs, the same way
 * a confirmed upload moves a ₹0 / ₹0 company. Run by
 * scripts/backfill-collection-logs.ts after approval, never by the app.
 *
 * Plain SQL with no server-only imports, so the script (postgres.js) and the
 * tests (PGlite) execute exactly the same statements.
 *
 * What counts, relative to the LATEST confirmed upload (the figures the
 * Tracker shows), for a company with no open closure:
 *   - "zero-line"           its line in the latest upload is ₹0 / ₹0 (or blank on a side)
 *   - "absent-from-latest"  it has lines in earlier uploads but none in the latest (shown — / —)
 *   - "never-uploaded"      it has never been in any confirmed upload (shown — / —)
 * The caller chooses which of these to move. A company with any non-zero
 * figure in the latest upload is never touched; nor is one already in Logs.
 *
 * What it writes: one open closure episode per moved company (append-only,
 * like the upload's own movement), with no employee (an automatic clean-up),
 * the latest upload as its reference and as-of date. Nothing else is created,
 * changed or deleted. Re-running moves nobody twice: the database allows one
 * open episode per company, and the insert skips any conflict. A later
 * upload that gives such a company a balance returns it to the Tracker like
 * any other logged company.
 */

export const BACKFILL_SOURCE_KEY = "tracker-balances-backfill";

export const BACKFILL_BUCKETS = ["zero-line", "absent-from-latest", "never-uploaded"] as const;
export type BackfillBucket = (typeof BACKFILL_BUCKETS)[number];

/** Runs one statement with positional parameters and returns its rows. */
export type Exec = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const CANDIDATES = `
  with latest as (
    select id, period_to from collection_balance_snapshots order by uploaded_at desc, id desc limit 1
  ),
  latest_line as (
    select l.company_id, l.debit, l.credit from collection_balance_lines l join latest on l.snapshot_id = latest.id
  ),
  any_line as (select distinct company_id from collection_balance_lines),
  candidates as (
    select m.id as company_id, ll.debit, ll.credit,
      case when ll.company_id is not null then 'zero-line'
           when a.company_id is not null then 'absent-from-latest'
           else 'never-uploaded' end as bucket
    from collection_master_companies m
    left join latest_line ll on ll.company_id = m.id
    left join any_line a on a.company_id = m.id
    where not exists (select 1 from collection_closures c where c.company_id = m.id and c.reopened_at is null)
      and (ll.company_id is null or (coalesce(ll.debit, 0) = 0 and coalesce(ll.credit, 0) = 0))
  )`;

/**
 * The reverse correction: companies in Collection Logs (an open episode) whose
 * line in the LATEST upload has a non-zero Debit or Credit. A logged company
 * with no line in the latest upload is not here: absence is not a balance.
 */
const RESTORE = `
  with latest as (
    select id from collection_balance_snapshots order by uploaded_at desc, id desc limit 1
  ),
  latest_line as (
    select l.company_id, l.debit, l.credit from collection_balance_lines l join latest on l.snapshot_id = latest.id
  ),
  restore as (
    select c.id as closure_id
    from collection_closures c
    join latest_line ll on ll.company_id = c.company_id
    where c.reopened_at is null and (coalesce(ll.debit, 0) <> 0 or coalesce(ll.credit, 0) <> 0)
  )`;

export interface BackfillCounts {
  /** False when no upload has ever been confirmed: there are no figures to go by, so nothing may move. */
  hasUpload: boolean;
  byBucket: Record<BackfillBucket, number>;
  /** In Collection Logs, but the latest upload gives them a non-zero Debit or Credit: to return to the Tracker. */
  toRestore: number;
  /** Already in Collection Logs (left as they are). */
  alreadyInLogs: number;
  /** Companies with a non-zero figure in the latest upload (stay in the Tracker). */
  withBalance: number;
  companies: number;
}

/** What the clean-up would move. Read-only. */
export async function countBackfill(exec: Exec): Promise<BackfillCounts> {
  const [snap] = await exec(`select count(*)::int as n from collection_balance_snapshots`);
  const hasUpload = Number(snap?.n ?? 0) > 0;
  const byBucket: Record<BackfillBucket, number> = { "zero-line": 0, "absent-from-latest": 0, "never-uploaded": 0 };
  if (hasUpload) {
    for (const r of await exec(`${CANDIDATES} select bucket, count(*)::int as n from candidates group by bucket`)) byBucket[r.bucket as BackfillBucket] = Number(r.n);
  }
  const [o] = await exec(`select count(*)::int as n from collection_closures where reopened_at is null`);
  const [c] = await exec(`select count(*)::int as n from collection_master_companies`);
  const [r] = hasUpload ? await exec(`${RESTORE} select count(*)::int as n from restore`) : [{ n: 0 }];
  const alreadyInLogs = Number(o?.n ?? 0);
  const companies = Number(c?.n ?? 0);
  const moved = hasUpload ? byBucket["zero-line"] + byBucket["absent-from-latest"] + byBucket["never-uploaded"] : 0;
  return { hasUpload, byBucket, toRestore: Number(r?.n ?? 0), alreadyInLogs, companies, withBalance: hasUpload ? companies - alreadyInLogs - moved : 0 };
}

/**
 * Returns to the Tracker every logged company the latest upload gives a
 * non-zero Debit or Credit: its open episode is marked reopened (never
 * deleted), with the latest upload as the reference. Same transaction and
 * lock as applyBackfill. Returns how many were restored.
 */
export async function applyRestore(exec: Exec): Promise<number> {
  const [snap] = await exec(`select count(*)::int as n from collection_balance_snapshots`);
  if (Number(snap?.n ?? 0) === 0) return 0;
  const rows = await exec(
    `${RESTORE}
    update collection_closures c
    set reopened_at = greatest(now(), c.closed_at), reopen_reason = 'outstanding_positive', reopen_source_ref = (select id::text from latest), reopened_by_id = null
    from restore r
    where c.id = r.closure_id and c.reopened_at is null
    returning c.company_id`,
  );
  return rows.length;
}

/**
 * Moves the chosen buckets into Collection Logs. Call inside ONE transaction,
 * holding the same lock as a balance upload so the two can't interleave.
 * Returns how many companies were moved.
 */
export async function applyBackfill(exec: Exec, buckets: readonly BackfillBucket[]): Promise<number> {
  const chosen = [...new Set(buckets)].filter((b): b is BackfillBucket => (BACKFILL_BUCKETS as readonly string[]).includes(b));
  if (chosen.length === 0) return 0;
  const [snap] = await exec(`select count(*)::int as n from collection_balance_snapshots`);
  if (Number(snap?.n ?? 0) === 0) throw new Error("No balance upload has been confirmed, so there are no figures to go by. Nothing was moved.");
  const rows = await exec(
    `${CANDIDATES}
    insert into collection_closures (company_id, close_reason, close_source_key, close_source_ref, final_outstanding, final_debit, final_credit, as_of_date, closed_by_id)
    select c.company_id, 'outstanding_zero', $2, (select id::text from latest), 0, c.debit, c.credit, (select period_to from latest), null
    from candidates c
    where c.bucket = any($1::text[])
    on conflict do nothing
    returning company_id`,
    [chosen, BACKFILL_SOURCE_KEY],
  );
  return rows.length;
}
