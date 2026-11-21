-- ROLLBACK of 0139 (Category F: email / letterhead identity, write-off input history). NEVER put this file in
-- db/migrations: nothing applies it automatically. Run it only after a separate approval, in ONE transaction, through
-- scripts/incentive-0139/rollback.ts.
--
-- It refuses (raises, so the transaction changes nothing) while ANY data that only 0139 allows exists: a decision with a
-- derived identity (an email or letterhead verification) or a write-off recorded in the input history. With none, it
-- restores 0138 exactly: drops 0139's two unique indexes, its identity check and its two columns, and puts back 0137's
-- input-history entity list.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "incentive_f_decisions" WHERE "evidence_message_id" IS NOT NULL OR "evidence_fingerprint" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "incentive_calc_input_history" WHERE "entity" = 'f-writeoff')
  THEN
    RAISE EXCEPTION '0139 rollback refused: data only 0139 allows exists (email or letterhead identities, or write-off history). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DROP INDEX IF EXISTS "incentive_f_decisions_message_id_uq";
DROP INDEX IF EXISTS "incentive_f_decisions_fingerprint_uq";
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_identity_check";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "evidence_message_id";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "evidence_fingerprint";

ALTER TABLE "incentive_calc_input_history" DROP CONSTRAINT IF EXISTS "incentive_calc_input_history_entity_check";
ALTER TABLE "incentive_calc_input_history" ADD CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event', 'b-override', 'c-review', 'f-decision')) NOT VALID;
ALTER TABLE "incentive_calc_input_history" VALIDATE CONSTRAINT "incentive_calc_input_history_entity_check";
