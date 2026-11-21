-- ROLLBACK of 0140 (Incentive calculation — Category B invoice review decisions). NEVER put this file in db/migrations:
-- nothing applies it automatically. Run it only through a hash-pinned script, in ONE transaction, after a separate
-- approval.
--
-- It refuses (raises, so the transaction changes nothing) while ANY invoice review decision exists, active or retired:
-- those are history. With none, it removes exactly what 0140 added. Nothing else is touched.

DO $$
BEGIN
  IF to_regclass('public.incentive_calc_b_invoice_reviews') IS NOT NULL AND EXISTS (SELECT 1 FROM "incentive_calc_b_invoice_reviews") THEN
    RAISE EXCEPTION '0140 rollback refused: Category B invoice review decisions exist (they are history). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "incentive_calc_b_invoice_approvals_insert" ON "incentive_calc_approvals";
DROP FUNCTION IF EXISTS "incentive_calc_b_invoice_approvals_check"();
DROP TABLE IF EXISTS "incentive_calc_b_invoice_reviews";
DROP FUNCTION IF EXISTS "incentive_calc_b_invoice_reviews_check"();
