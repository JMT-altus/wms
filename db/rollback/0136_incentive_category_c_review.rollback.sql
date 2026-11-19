-- ROLLBACK of 0136 (Incentive calculation — Category C corrections). NEVER put this file in db/migrations: nothing
-- applies it automatically. Run it only through its hash-pinned script, in ONE transaction, after a separate approval.
--
-- It refuses (raises, so the transaction changes nothing) while ANY data that only 0136 allows exists: a Category C
-- review decision (active or retired), its input history, ANY carry-forward ledger entry, ANY voided month, a setting with one of 0136's six new keys, or a Category C
-- setting of the three Category A settings 0136 lets Category C use. The keys are matched EXACTLY (no pattern), so a
-- shared caps.* / collection.* / adjust.* setting of any other category never holds it back. With none, it removes
-- exactly what 0136 added and restores 0135's settings list and settings-by-category function and 0134's input-history
-- entity check (each copied verbatim). Category A and B configuration is never touched.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "incentive_calc_c_reviews")
     OR EXISTS (SELECT 1 FROM "incentive_calc_carry")
     OR EXISTS (SELECT 1 FROM "incentive_calc_period_voids")
     OR EXISTS (SELECT 1 FROM "incentive_calc_input_history" WHERE "entity" = 'c-review')
     OR EXISTS (SELECT 1 FROM "incentive_config_settings" WHERE "setting_key" IN ('c.turnoverWindowMonths', 'c.turnoverBasis', 'payout.minimumPayable', 'payout.belowMinimum', 'payout.carryForwardExpiry', 'payout.carryForwardExpiryMonths'))
     OR EXISTS (SELECT 1 FROM "incentive_config_settings" s JOIN "incentive_config_versions" v ON v."id" = s."version_id" WHERE v."category_code" = 'C' AND s."setting_key" IN ('collection.payableWhen', 'adjust.creditNote', 'adjust.salesReturn'))
  THEN
    RAISE EXCEPTION '0136 rollback refused: data only 0136 allows exists (Category C review decisions, their history, carry-forward ledger entries, voided months, or settings it added). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "incentive_calc_c_approvals_insert" ON "incentive_calc_approvals";
DROP FUNCTION IF EXISTS "incentive_calc_c_approvals_check"();
DROP TABLE IF EXISTS "incentive_calc_period_voids";
DROP FUNCTION IF EXISTS "incentive_calc_period_voids_check"();
DROP TABLE IF EXISTS "incentive_calc_carry";
DROP FUNCTION IF EXISTS "incentive_calc_carry_check"();
DROP TABLE IF EXISTS "incentive_calc_c_reviews";
DROP FUNCTION IF EXISTS "incentive_calc_c_reviews_check"();

-- 0134's input-history entity check
ALTER TABLE "incentive_calc_input_history" DROP CONSTRAINT IF EXISTS "incentive_calc_input_history_entity_check";
ALTER TABLE "incentive_calc_input_history" ADD CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event', 'b-override')) NOT VALID;
ALTER TABLE "incentive_calc_input_history" VALIDATE CONSTRAINT "incentive_calc_input_history_entity_check";

-- 0135's settings-by-category function, verbatim
CREATE OR REPLACE FUNCTION "incentive_config_settings_category_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c text;
BEGIN
  SELECT "category_code" INTO c FROM "incentive_config_versions" WHERE "id" = NEW."version_id";
  IF NEW."setting_key" ~ '^[b-g]\.' AND upper(substr(NEW."setting_key", 1, 1)) IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'Setting % belongs to Category % versions only', NEW."setting_key", upper(substr(NEW."setting_key", 1, 1)) USING ERRCODE = 'check_violation';
  END IF;
  IF c IS DISTINCT FROM 'A' AND NEW."setting_key" IN (
    'basis.document', 'basis.amount', 'basis.monthDate', 'basis.preClosure', 'basis.categoryBOrders',
    'eligibility.threshold', 'eligibility.thresholdComparison',
    'slabs.method', 'slabs.boundaries', 'slabs.aboveTop', 'slabs.aboveTopAmount', 'slabs.gaps',
    'allocation.method', 'allocation.eligibleOrders', 'allocation.minOrderAmount',
    'collection.payableWhen', 'adjust.creditNote', 'adjust.salesReturn'
  ) THEN
    RAISE EXCEPTION 'Setting % isn''t a Category % setting', NEW."setting_key", c USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- 0135's settings list
ALTER TABLE "incentive_config_settings" DROP CONSTRAINT IF EXISTS "incentive_config_settings_key_check";
ALTER TABLE "incentive_config_settings" ADD CONSTRAINT "incentive_config_settings_key_check" CHECK ("setting_key" IN (
  -- settings-key-list-begin
  'basis.document', 'basis.amount', 'basis.monthDate', 'basis.voucherFilter', 'basis.preClosure',
  'eligibility.threshold', 'eligibility.thresholdComparison',
  'slabs.method', 'slabs.boundaries', 'slabs.aboveTop', 'slabs.aboveTopAmount', 'slabs.gaps',
  'allocation.method', 'allocation.eligibleOrders', 'allocation.minOrderAmount',
  'collection.delayFrom', 'collection.stepBoundary', 'collection.dueDateFallback', 'collection.defaultDays',
  'collection.missingDueDate', 'collection.recoveryAfterNil', 'collection.earningBasis', 'collection.payableWhen',
  'collection.unreceivedPortion', 'collection.onAccountReceipts', 'collection.multiInvoiceReceipts',
  'adjust.creditNote', 'adjust.salesReturn', 'adjust.refund', 'adjust.bouncedCheque', 'adjust.reversedReceipt',
  'adjust.openMonths', 'adjust.lockedOrPaidMonths', 'adjust.negativeBalance', 'adjust.carryForwardMonths', 'adjust.windowDays',
  'attribution.source', 'attribution.historical', 'attribution.split', 'eligibility.inactiveEmployees',
  'period.unit', 'period.recalcUntil', 'period.recalcDays', 'period.lockMode', 'period.autoLockDays', 'period.lateReceipts',
  'rounding.method', 'rounding.precision', 'rounding.level',
  'caps.perOrder', 'caps.perEmployeeCategoryMonth', 'caps.perEmployeeAllCategoriesMonth',
  'payout.approvalSteps', 'payout.release',
  'basis.categoryBOrders', 'caps.allCategoriesPolicy', 'caps.allCategoriesOrder',
  'b.existingLookbackMonths', 'b.noveltyWindow', 'b.noveltyLookbackMonths', 'b.minAmount', 'b.ratePpm',
  'b.salesReturns', 'b.recoveryExpiry',
  'c.newCustomerLookbackMonths', 'c.requiredTransactions', 'c.minTurnover', 'c.amountBasis', 'c.ratePpm',
  'd.leadsPerUnit', 'd.leadUnitAmount', 'd.leadsMustBeProfiled', 'd.conversionsPerUnit', 'd.conversionUnitAmount', 'd.unitCounting',
  'e.minAward', 'e.maxAward',
  'f.googleReviewAmount', 'f.googleMinWords', 'f.googleFiveStarOnly', 'f.googleNeedsEvidence', 'f.emailAmount', 'f.letterheadAmount', 'f.namedMultiple',
  'g.consecutiveMonths', 'g.minMonthlyPurchase', 'g.purchaseBasis', 'g.rewardAmount', 'g.afterReward'
  -- settings-key-list-end
)) NOT VALID;
ALTER TABLE "incentive_config_settings" VALIDATE CONSTRAINT "incentive_config_settings_key_check";
