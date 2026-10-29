-- 0119 Collection closures — the history behind Collection Logs.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0000 (employees) and 0112
-- (collection_master_companies). Do not run anywhere shared until reviewed.
-- Never apply through `pnpm db:migrate` (it would also apply every other pending
-- file); apply this one file, with the role the app connects as (DATABASE_URL).
--
-- One row per CLOSURE EPISODE of a Collection Master company: when the approved
-- source confirmed its outstanding balance was exactly zero, from which source
-- and reference, the exact final figures, and — if a later approved figure was
-- positive again — when and why it was reopened. A reopened company that later
-- reaches zero again gets a NEW row, so every episode stays in the history.
-- Append-only by design: nothing here is deleted, and an episode's closing
-- fields never change once written.
--
-- NOTHING WRITES TO THIS TABLE YET. No outstanding-balance source has been
-- approved, so automatic closure is not implemented; Collection Logs only reads
-- this table and shows an empty state until the closure rule is approved and
-- built separately.
--
-- Rows reference the Collection Master by id (ON DELETE RESTRICT): a company
-- with closure history can never be deleted, and no company, follow-up,
-- commitment, confirmation or escalation is created, changed or removed here.
--
-- No direct REST access: RLS on with no policies, and the Supabase REST roles
-- (`anon`, `authenticated`) have no privileges — the app reads and writes only
-- from the server. Skipped cleanly where those roles don't exist (same pattern
-- as 0114 / 0115 / 0117).

CREATE TABLE IF NOT EXISTS "collection_closures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "collection_master_companies"("id") ON DELETE RESTRICT,
  "closed_at" timestamptz NOT NULL DEFAULT now(),
  "close_reason" text NOT NULL,
  -- Which approved source confirmed the zero, and its reference (e.g. a snapshot or sync id).
  "close_source_key" text NOT NULL,
  "close_source_ref" text,
  -- Exactly as the source gave them; numeric, never a float.
  "final_outstanding" numeric(16, 2) NOT NULL,
  "final_debit" numeric(16, 2),
  "final_credit" numeric(16, 2),
  -- The date the source's figures are "as of", when it states one.
  "as_of_date" date,
  -- NULL for an automatic closure; the employee for a human-triggered operation.
  "closed_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "reopened_at" timestamptz,
  "reopen_reason" text,
  "reopen_source_ref" text,
  "reopened_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  CONSTRAINT "collection_closures_close_reason_check" CHECK ("close_reason" IN ('outstanding_zero')),
  CONSTRAINT "collection_closures_source_key_check" CHECK (btrim("close_source_key") <> ''),
  -- An "outstanding is zero" closure records exactly zero — no tolerance.
  CONSTRAINT "collection_closures_zero_check" CHECK ("close_reason" <> 'outstanding_zero' OR "final_outstanding" = 0),
  CONSTRAINT "collection_closures_reopen_reason_check" CHECK ("reopen_reason" IS NULL OR "reopen_reason" IN ('outstanding_positive')),
  -- Open: no reopening fields at all. Reopened: at least when and why.
  CONSTRAINT "collection_closures_reopen_check" CHECK (
    ("reopened_at" IS NULL AND "reopen_reason" IS NULL AND "reopen_source_ref" IS NULL AND "reopened_by_id" IS NULL)
    OR ("reopened_at" IS NOT NULL AND "reopen_reason" IS NOT NULL AND "reopened_at" >= "closed_at")
  )
);

-- At most ONE open closure per company: repeated or concurrent attempts to close
-- an already-closed company are refused by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS "collection_closures_one_open_uq"
  ON "collection_closures" ("company_id") WHERE "reopened_at" IS NULL;

CREATE INDEX IF NOT EXISTS "collection_closures_company_idx"
  ON "collection_closures" ("company_id", "closed_at" DESC);

CREATE INDEX IF NOT EXISTS "collection_closures_closed_at_idx"
  ON "collection_closures" ("closed_at" DESC);

ALTER TABLE "collection_closures" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.collection_closures FROM %I', r);
    END IF;
  END LOOP;
END
$$;
