-- ROLLBACK of 0134 (Incentive calculation — Category B). NEVER put this file in db/migrations: nothing applies it
-- automatically. Run it only through its hash-pinned script, in ONE transaction, after a separate approval.
--
-- It refuses (raises, so the transaction changes nothing) while ANY Category B data exists: a Category B run, period or
-- adjustment, a manual qualification decision or its history, qualification evidence, or a setting that only 0134
-- allows. With none, it removes exactly what 0134 added and restores 0131's, 0132's and 0133's own checks.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "incentive_calc_runs" WHERE "category_code" <> 'A')
     OR EXISTS (SELECT 1 FROM "incentive_calc_periods" WHERE "category_code" <> 'A')
     OR EXISTS (SELECT 1 FROM "incentive_calc_adjustments" WHERE "category_code" <> 'A')
     OR EXISTS (SELECT 1 FROM "incentive_calc_b_overrides")
     OR EXISTS (SELECT 1 FROM "incentive_calc_b_qualifications")
     OR EXISTS (SELECT 1 FROM "incentive_calc_input_history" WHERE "entity" = 'b-override')
     OR EXISTS (SELECT 1 FROM "incentive_config_settings" WHERE "setting_key" IN (
       'basis.categoryBOrders', 'caps.allCategoriesPolicy', 'caps.allCategoriesOrder',
       'b.existingLookbackMonths', 'b.noveltyWindow', 'b.noveltyLookbackMonths', 'b.minAmount', 'b.ratePpm', 'b.salesReturns', 'b.recoveryExpiry'))
  THEN
    RAISE EXCEPTION '0134 rollback refused: Category B data exists (runs, periods, adjustments, decisions, evidence or Category B settings). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- separation of duties
DROP TRIGGER IF EXISTS "incentive_calc_b_approvals_insert" ON "incentive_calc_approvals";
DROP FUNCTION IF EXISTS "incentive_calc_b_approvals_check"();

-- the two tables (empty, as checked above)
DROP TABLE IF EXISTS "incentive_calc_b_qualifications";
DROP TABLE IF EXISTS "incentive_calc_b_overrides";
DROP FUNCTION IF EXISTS "incentive_calc_b_overrides_check"();

-- settings and slabs by category
DROP TRIGGER IF EXISTS "incentive_config_settings_category" ON "incentive_config_settings";
DROP FUNCTION IF EXISTS "incentive_config_settings_category_check"();
DROP TRIGGER IF EXISTS "incentive_config_slabs_category" ON "incentive_config_slabs";
DROP FUNCTION IF EXISTS "incentive_config_slabs_category_check"();

-- 0133's input-history entities
ALTER TABLE "incentive_calc_input_history" DROP CONSTRAINT IF EXISTS "incentive_calc_input_history_entity_check";
ALTER TABLE "incentive_calc_input_history" ADD CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event'));

-- 0132's Category A-only checks
ALTER TABLE "incentive_calc_runs" DROP CONSTRAINT IF EXISTS "incentive_calc_runs_category_check";
ALTER TABLE "incentive_calc_runs" ADD CONSTRAINT "incentive_calc_runs_category_check" CHECK ("category_code" = 'A');
ALTER TABLE "incentive_calc_periods" DROP CONSTRAINT IF EXISTS "incentive_calc_periods_category_check";
ALTER TABLE "incentive_calc_periods" ADD CONSTRAINT "incentive_calc_periods_category_check" CHECK ("category_code" = 'A');
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_category_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_category_check" CHECK ("category_code" = 'A');

-- 0131's settings list
ALTER TABLE "incentive_config_settings" DROP CONSTRAINT IF EXISTS "incentive_config_settings_key_check";
ALTER TABLE "incentive_config_settings" ADD CONSTRAINT "incentive_config_settings_key_check" CHECK ("setting_key" IN (
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
  'payout.approvalSteps', 'payout.release'
));
