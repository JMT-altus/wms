-- ROLLBACK of 0135 (Incentive calculation — Categories C–G). NEVER put this file in db/migrations: nothing applies it
-- automatically. Run it only through its hash-pinned script, in ONE transaction, after a separate approval.
--
-- It refuses (raises, so the transaction changes nothing) while ANY Category C–G data exists: a run, period or
-- adjustment of C–G, an item, or a setting only 0135 allows. With none, it removes exactly what 0135 added and restores
-- 0134's own definitions (copied verbatim from 0134).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "incentive_calc_runs" WHERE "category_code" NOT IN ('A', 'B'))
     OR EXISTS (SELECT 1 FROM "incentive_calc_periods" WHERE "category_code" NOT IN ('A', 'B'))
     OR EXISTS (SELECT 1 FROM "incentive_calc_adjustments" WHERE "category_code" NOT IN ('A', 'B'))
     OR EXISTS (SELECT 1 FROM "incentive_calc_items")
     OR EXISTS (SELECT 1 FROM "incentive_config_settings" WHERE "setting_key" ~ '^[c-g]\.')
  THEN
    RAISE EXCEPTION '0135 rollback refused: Category C–G data exists (runs, periods, adjustments, items or settings). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DROP TABLE IF EXISTS "incentive_calc_items";

ALTER TABLE "incentive_calc_runs" DROP CONSTRAINT IF EXISTS "incentive_calc_runs_category_check";
ALTER TABLE "incentive_calc_runs" ADD CONSTRAINT "incentive_calc_runs_category_check" CHECK ("category_code" IN ('A', 'B'));
ALTER TABLE "incentive_calc_periods" DROP CONSTRAINT IF EXISTS "incentive_calc_periods_category_check";
ALTER TABLE "incentive_calc_periods" ADD CONSTRAINT "incentive_calc_periods_category_check" CHECK ("category_code" IN ('A', 'B'));
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_category_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_category_check" CHECK ("category_code" IN ('A', 'B'));

-- 0134's settings-by-category function, verbatim
CREATE OR REPLACE FUNCTION "incentive_config_settings_category_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c text;
BEGIN
  SELECT "category_code" INTO c FROM "incentive_config_versions" WHERE "id" = NEW."version_id";
  IF NEW."setting_key" LIKE 'b.%' AND c IS DISTINCT FROM 'B' THEN
    RAISE EXCEPTION 'Setting % belongs to Category B versions only', NEW."setting_key" USING ERRCODE = 'check_violation';
  END IF;
  IF c = 'B' AND NEW."setting_key" IN (
    'basis.document', 'basis.amount', 'basis.monthDate', 'basis.preClosure', 'basis.categoryBOrders',
    'eligibility.threshold', 'eligibility.thresholdComparison',
    'slabs.method', 'slabs.boundaries', 'slabs.aboveTop', 'slabs.aboveTopAmount', 'slabs.gaps',
    'allocation.method', 'allocation.eligibleOrders', 'allocation.minOrderAmount',
    'collection.payableWhen', 'adjust.creditNote', 'adjust.salesReturn'
  ) THEN
    RAISE EXCEPTION 'Setting % isn''t a Category B setting', NEW."setting_key" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- 0134's settings list
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
  'b.salesReturns', 'b.recoveryExpiry'
  -- settings-key-list-end
));
