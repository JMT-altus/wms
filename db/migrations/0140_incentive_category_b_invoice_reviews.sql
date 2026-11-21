-- 0140 Incentive calculation — Category B: a review decision on an invoice with no Sales Order.
--
-- NOT APPLIED. Prepared only; it needs its own approval. Depends on 0131–0134, which it extends; none of them is changed.
-- Never apply through pnpm db:migrate; apply this one file only through a hash-pinned runner after a separate approval.
-- Its rollback is db/rollback/0140_incentive_category_b_invoice_reviews.rollback.sql.
--
-- WHY. Category B's calculation lists every invoice of the month with no Sales Order in Forms (or naming one that isn't
-- there) as "needs review": whether it is a Category B sale can't be evaluated, so it is never qualified automatically.
-- Until now nobody could act on it on the Category B screens, and it held nothing up. With this table an authorised
-- person records a decision on it, always with a reason; until every such invoice of the month is decided, the month is
-- not submitted, approved or paid (the service checks it at each step).
--
-- WHAT.
--   incentive_calc_b_invoice_reviews   an authorised admin's decision on a Forms SALES INVOICE that Category B could not
--                                      evaluate, with its reason:
--                                        not-category-b   reviewed: it is not a Category B sale (it stays out, as now).
--                                      A decision never qualifies anything and never changes a calculation: to count an
--                                      invoice, its Sales Order link is corrected in Forms and the month recalculated.
--                                      Retire-only (0133's input guard); one ACTIVE decision per invoice; the invoice must
--                                      be a Forms sales invoice (checked by trigger).
--   Separation of duties: whoever recorded or retired a decision on an invoice listed for review in a Category B month's
--     calculation never approves or rejects that month (a new trigger on incentive_calc_approvals; 0133's and 0134's
--     checks still apply).
--
-- No existing row is changed. RLS on, no policies, REST roles revoked. Safe to re-run.

CREATE TABLE IF NOT EXISTS "incentive_calc_b_invoice_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_document_id" uuid NOT NULL REFERENCES "tally_documents"("id") ON DELETE RESTRICT,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz,
  "retired_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "retired_reason" text,
  CONSTRAINT "incentive_calc_b_invoice_reviews_decision_check" CHECK ("decision" IN ('not-category-b')),
  CONSTRAINT "incentive_calc_b_invoice_reviews_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
  CONSTRAINT "incentive_calc_b_invoice_reviews_name_check" CHECK (length(btrim("created_by_name")) BETWEEN 1 AND 200),
  CONSTRAINT "incentive_calc_b_invoice_reviews_retired_check" CHECK (("retired_at" IS NULL AND "retired_reason" IS NULL) OR ("retired_at" IS NOT NULL AND length(btrim(coalesce("retired_reason", ''))) BETWEEN 1 AND 1000))
);
-- One ACTIVE decision per invoice (retired ones stay as history).
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_b_invoice_reviews_active_uq" ON "incentive_calc_b_invoice_reviews" ("invoice_document_id") WHERE "retired_at" IS NULL;
CREATE INDEX IF NOT EXISTS "incentive_calc_b_invoice_reviews_invoice_idx" ON "incentive_calc_b_invoice_reviews" ("invoice_document_id", "created_at");

-- The decision names a Forms sales invoice, and is recorded active (it is retired later, never inserted retired).
CREATE OR REPLACE FUNCTION "incentive_calc_b_invoice_reviews_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_b_invoice_reviews'), hashtext(NEW."invoice_document_id"::text));
  IF NOT EXISTS (SELECT 1 FROM "tally_documents" WHERE "id" = NEW."invoice_document_id" AND "document_type" = 'sales-invoices') THEN
    RAISE EXCEPTION 'A Category B invoice review decision is recorded on a Forms sales invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."retired_at" IS NOT NULL THEN
    RAISE EXCEPTION 'An invoice review decision is recorded active and retired later' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_b_invoice_reviews_insert" ON "incentive_calc_b_invoice_reviews";
CREATE TRIGGER "incentive_calc_b_invoice_reviews_insert" BEFORE INSERT ON "incentive_calc_b_invoice_reviews" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_b_invoice_reviews_check"();
-- Retire-only (0133's input guard): never edited, never deleted.
DROP TRIGGER IF EXISTS "incentive_calc_b_invoice_reviews_guard" ON "incentive_calc_b_invoice_reviews";
CREATE TRIGGER "incentive_calc_b_invoice_reviews_guard" BEFORE UPDATE OR DELETE ON "incentive_calc_b_invoice_reviews" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_input_guard"();

-- ── separation of duties ──────────────────────────────────────────────────────
-- Whoever recorded or retired a decision on an invoice listed for review in a Category B month's calculation never
-- approves or rejects that month.
CREATE OR REPLACE FUNCTION "incentive_calc_b_invoice_approvals_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."actor_id" IS NOT NULL AND (SELECT "category_code" FROM "incentive_calc_periods" WHERE "id" = NEW."period_id") = 'B' AND EXISTS (
    SELECT 1 FROM "incentive_calc_runs" run
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(run."result"->'reviewInvoices', '[]'::jsonb)) ri
    JOIN "incentive_calc_b_invoice_reviews" d ON d."invoice_document_id"::text = ri->>'invoiceId'
    WHERE run."id" = NEW."run_id" AND (d."created_by_id" = NEW."actor_id" OR d."retired_by_id" = NEW."actor_id")
  ) THEN
    RAISE EXCEPTION 'Whoever decided a Category B invoice review never approves or rejects that month' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_b_invoice_approvals_insert" ON "incentive_calc_approvals";
CREATE TRIGGER "incentive_calc_b_invoice_approvals_insert" BEFORE INSERT ON "incentive_calc_approvals" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_b_invoice_approvals_check"();

-- ── descriptions ──────────────────────────────────────────────────────────────
COMMENT ON TABLE "incentive_calc_b_invoice_reviews" IS 'Category B: an authorised admin''s decision, with its reason, on a sales invoice with no Sales Order in Forms (reviewed: not a Category B sale). Never qualifies anything or changes a calculation. Retire-only; one active decision per invoice.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_b_invoice_reviews" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_calc_b_invoice_reviews FROM %I', r);
    END IF;
  END LOOP;
END
$$;
