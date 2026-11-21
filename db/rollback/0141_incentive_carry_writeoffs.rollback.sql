-- ROLLBACK of 0141 (two-person write-off of carried-forward balances). NEVER put this file in db/migrations: nothing
-- applies it automatically. Run it only through a hash-pinned script, in ONE transaction, after a separate approval.
--
-- It refuses (raises, so the transaction changes nothing) while ANY write-off request or decision exists: those are
-- history. With none, it removes exactly what 0141 added (the table and the ledger's commit-time check). The ledger
-- itself (0136) is never touched.

DO $$
BEGIN
  IF to_regclass('public.incentive_calc_carry_writeoffs') IS NOT NULL AND EXISTS (SELECT 1 FROM "incentive_calc_carry_writeoffs") THEN
    RAISE EXCEPTION '0141 rollback refused: carry-forward write-off requests or decisions exist (they are history). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "incentive_calc_carry_writeoff_approved" ON "incentive_calc_carry";
DROP FUNCTION IF EXISTS "incentive_calc_carry_writeoff_approved"();
DROP TABLE IF EXISTS "incentive_calc_carry_writeoffs";
DROP FUNCTION IF EXISTS "incentive_calc_carry_writeoffs_check"();
