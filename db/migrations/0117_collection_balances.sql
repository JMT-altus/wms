-- 0117 Collection balances — Tally customer-summary snapshots (Debit / Credit per company).
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0000 (employees) and 0112
-- (collection_master_companies). Do not run anywhere shared until reviewed.
-- Never apply through `pnpm db:migrate` (it would also apply every other pending
-- file); apply this one file, with the role the app connects as (DATABASE_URL).
--
-- Each applied upload of the Tally "Sundry Debtors / Group Outstandings" summary
-- is ONE snapshot row, with one line per matched Collection Master company. The
-- Collection Tracker shows only the NEWEST snapshot's lines, so repeated uploads
-- replace — never add to — what is shown. A company missing from the newest
-- snapshot has no line there and shows blank. Older snapshots are kept for audit.
-- Append-only: the app never updates or deletes rows here.
--
-- Customer-level figures only: no invoices, due dates or payment statuses, and
-- no outstanding balance is stored or derived. Lines reference the Collection
-- Master by id (ON DELETE RESTRICT) and never create or change a company.
--
-- No direct REST access: RLS on with no policies, and the Supabase REST roles
-- (`anon`, `authenticated`) have no privileges — the app reads and writes only
-- from the server. Skipped cleanly where those roles don't exist (same pattern
-- as 0114 / 0115).

CREATE TABLE IF NOT EXISTS "collection_balance_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_name" text,
  "sheet_name" text,
  -- SHA-256 of the sheet's cell contents, computed by the server (not the client).
  "file_hash" text,
  "report_title" text,
  "period_from" date,
  "period_to" date,
  "source_total_debit" numeric(16, 2),
  "source_total_credit" numeric(16, 2),
  "imported_total_debit" numeric(16, 2) NOT NULL,
  "imported_total_credit" numeric(16, 2) NOT NULL,
  "totals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "uploaded_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "uploaded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_balance_snapshots_period_check"
    CHECK ("period_from" IS NULL OR "period_to" IS NULL OR "period_from" <= "period_to")
);

CREATE INDEX IF NOT EXISTS "collection_balance_snapshots_at_idx"
  ON "collection_balance_snapshots" ("uploaded_at" DESC);

CREATE TABLE IF NOT EXISTS "collection_balance_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "snapshot_id" uuid NOT NULL REFERENCES "collection_balance_snapshots"("id") ON DELETE RESTRICT,
  "company_id" uuid NOT NULL REFERENCES "collection_master_companies"("id") ON DELETE RESTRICT,
  "source_name" text NOT NULL,
  "source_row" integer NOT NULL,
  "debit" numeric(14, 2),
  "credit" numeric(14, 2),
  CONSTRAINT "collection_balance_lines_value_check" CHECK ("debit" IS NOT NULL OR "credit" IS NOT NULL)
);

-- One line per company per snapshot: a snapshot can never count a company twice.
CREATE UNIQUE INDEX IF NOT EXISTS "collection_balance_lines_snapshot_company_uq"
  ON "collection_balance_lines" ("snapshot_id", "company_id");

CREATE INDEX IF NOT EXISTS "collection_balance_lines_company_idx"
  ON "collection_balance_lines" ("company_id");

ALTER TABLE "collection_balance_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection_balance_lines" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collection_balance_snapshots', 'collection_balance_lines'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
