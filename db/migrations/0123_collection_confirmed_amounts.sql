-- 0123 Collection Amount Confirmation — the confirmed AMOUNT, kept apart from the Yes/No answer.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0112 (collection_master_companies),
-- 0115 (collection_escalations) and "employees". Independent of 0118–0122.
-- Never apply through `pnpm db:migrate` (it would also apply every other pending
-- file); apply this one file, with the role the app connects as (DATABASE_URL).
--
-- What changes, and what does not:
--   * collection_confirmed_amounts — NEW, append-only history of the confirmed
--     amount a Tracker user enters per company (rupees, exact to the paise:
--     numeric(14,2), the same type as collection_commitments.committed_amount).
--     The current amount is the newest row; no row means "not entered". Rows are
--     never updated or deleted by the app, so every change stays on record with
--     who entered it and when. A confirmed amount is a separate business value:
--     entering one does NOT answer the Yes/No question and verifies nothing.
--   * collection_escalations gets ONE nullable column,
--     confirmed_amount_at_escalation: the confirmed amount in force when the
--     company was escalated, so reviewers see what was entered at that moment.
--     Existing escalations keep it NULL (raised before amounts existed; no
--     backfill, no existing row changed). The Yes/No snapshot
--     (confirmation_at_escalation) is untouched and stays beside it.
--   * collection_amount_confirmations and its yes/no CHECK are NOT touched.
--
-- Access follows 0115: RLS on with no policies, and the Supabase REST roles
-- (`anon`, `authenticated`) get no privileges — the app reads and writes only
-- from the server, as the role it connects with. Skipped cleanly where those
-- roles don't exist. The new column on collection_escalations is covered by the
-- table-level REVOKE 0115 already made.
--
-- Additive and safe to re-run (IF NOT EXISTS / existence checks). The new CHECK
-- on collection_escalations is validated against the existing rows, which pass
-- because their value is NULL.

CREATE TABLE IF NOT EXISTS "collection_confirmed_amounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "collection_master_companies"("id") ON DELETE RESTRICT,
  "amount" numeric(14,2) NOT NULL,
  "recorded_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_confirmed_amounts_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "collection_confirmed_amounts_company_idx"
  ON "collection_confirmed_amounts" ("company_id", "recorded_at");

ALTER TABLE "collection_confirmed_amounts" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.collection_confirmed_amounts FROM %I', r);
    END IF;
  END LOOP;
END
$$;

ALTER TABLE "collection_escalations" ADD COLUMN IF NOT EXISTS "confirmed_amount_at_escalation" numeric(14,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_escalations_confirmed_amount_check'
      AND conrelid = 'public.collection_escalations'::regclass
  ) THEN
    ALTER TABLE "collection_escalations" ADD CONSTRAINT "collection_escalations_confirmed_amount_check"
      CHECK ("confirmed_amount_at_escalation" IS NULL OR "confirmed_amount_at_escalation" > 0);
  END IF;
END
$$;
