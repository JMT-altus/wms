-- ROLLBACK of 0142 (Category A: acknowledgments of held items, two-person negative balances, database safeguards).
-- NEVER put this file in db/migrations: nothing applies it automatically. Run it only through the hash-pinned runner
-- (scripts/incentive-0142/rollback.ts), in ONE transaction, after a separate approval.
--
-- It refuses (raises, so the transaction changes nothing) while ANY acknowledgment or negative-balance decision exists:
-- those are history. With none, it removes exactly what 0142 added (two tables, their functions and the checks it put on
-- incentive_calc_adjustments, incentive_calc_approvals and incentive_calc_payouts). Nothing else is touched.

DO $$
BEGIN
  IF to_regclass('public.incentive_calc_a_reviews') IS NOT NULL AND EXISTS (SELECT 1 FROM "incentive_calc_a_reviews") THEN
    RAISE EXCEPTION '0142 rollback refused: acknowledgments of held Category A items exist (they are history). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF to_regclass('public.incentive_calc_negative_decisions') IS NOT NULL AND EXISTS (SELECT 1 FROM "incentive_calc_negative_decisions") THEN
    RAISE EXCEPTION '0142 rollback refused: negative-balance decisions exist (they are history). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "incentive_calc_a_payout_reconciled" ON "incentive_calc_payouts";
DROP FUNCTION IF EXISTS "incentive_calc_a_payout_reconciled"();
DROP TRIGGER IF EXISTS "incentive_calc_a_payouts_insert" ON "incentive_calc_payouts";
DROP FUNCTION IF EXISTS "incentive_calc_a_payouts_check"();
DROP TRIGGER IF EXISTS "incentive_calc_a_approvals_insert" ON "incentive_calc_approvals";
DROP FUNCTION IF EXISTS "incentive_calc_a_approvals_check"();
DROP TRIGGER IF EXISTS "incentive_calc_a_negative_approved" ON "incentive_calc_adjustments";
DROP FUNCTION IF EXISTS "incentive_calc_a_negative_approved"();
DROP TABLE IF EXISTS "incentive_calc_negative_decisions";
DROP FUNCTION IF EXISTS "incentive_calc_negative_decisions_check"();
DROP TABLE IF EXISTS "incentive_calc_a_reviews";
DROP FUNCTION IF EXISTS "incentive_calc_a_reviews_check"();
