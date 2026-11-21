-- ROLLBACK of 0137 (Incentive calculation — Category F Google reviews). NEVER put this file in db/migrations: nothing
-- applies it automatically. Run it only through its hash-pinned runner (scripts/incentive-0137), in ONE transaction,
-- after a separate approval.
--
-- It refuses (raises, so the transaction changes nothing) while ANY data that only 0137 allows exists: a Category F
-- review, submission, decision or write-off, an 'f-decision' input history row, a setting with one of 0137's four keys,
-- a 'recovery-write-off' adjustment, a testimonial without its employee (only SET NULL allows it), or a testimonial
-- whose kept name differs from its employee's (dropping the column would lose it). With none, it removes exactly what
-- 0137 added and restores 0136's settings list and entity check, 0132's adjustment checks and testimonials' NOT NULL
-- employee with ON DELETE CASCADE (each copied verbatim).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "incentive_f_reviews")
     OR EXISTS (SELECT 1 FROM "incentive_f_submissions")
     OR EXISTS (SELECT 1 FROM "incentive_f_decisions")
     OR EXISTS (SELECT 1 FROM "incentive_f_writeoffs")
     OR EXISTS (SELECT 1 FROM "incentive_calc_input_history" WHERE "entity" = 'f-decision')
     OR EXISTS (SELECT 1 FROM "incentive_config_settings" WHERE "setting_key" IN ('f.namedBonusAmount', 'f.minRating', 'f.minQualifyingReviews', 'f.recoveryExpiry'))
     OR EXISTS (SELECT 1 FROM "incentive_calc_adjustments" WHERE "kind" = 'recovery-write-off')
     OR EXISTS (SELECT 1 FROM "testimonials" WHERE "employee_id" IS NULL)
     OR EXISTS (SELECT 1 FROM "testimonials" t JOIN "employees" e ON e."id" = t."employee_id" WHERE t."employee_name" IS DISTINCT FROM e."name")
  THEN
    RAISE EXCEPTION '0137 rollback refused: data only 0137 allows exists (Category F reviews, submissions, decisions or write-offs, their history, settings or write-off adjustments it added, or testimonials whose employee was removed or renamed). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "incentive_calc_f_approvals_insert" ON "incentive_calc_approvals";
DROP FUNCTION IF EXISTS "incentive_calc_f_approvals_check"();
DROP TABLE IF EXISTS "incentive_f_writeoffs";
DROP FUNCTION IF EXISTS "incentive_f_writeoffs_check"();
DROP TABLE IF EXISTS "incentive_f_decisions";
DROP FUNCTION IF EXISTS "incentive_f_decisions_check"();
DROP FUNCTION IF EXISTS "incentive_f_decisions_guard"();
DROP TABLE IF EXISTS "incentive_f_submissions";
DROP TABLE IF EXISTS "incentive_f_reviews";

-- testimonials: back to a required employee, deleted with them (0068)
ALTER TABLE "testimonials" DROP CONSTRAINT IF EXISTS "testimonials_employee_named_check";
ALTER TABLE "testimonials" DROP CONSTRAINT IF EXISTS "testimonials_employee_id_fkey";
ALTER TABLE "testimonials" ALTER COLUMN "employee_id" SET NOT NULL;
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;
DROP TRIGGER IF EXISTS "testimonials_employee_name" ON "testimonials";
DROP FUNCTION IF EXISTS "testimonials_employee_name_fill"();
ALTER TABLE "testimonials" DROP COLUMN IF EXISTS "employee_name";

-- 0132's adjustment checks
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_writeoff_check";
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_kind_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_kind_check" CHECK ("kind" IN ('recalc-difference', 'negative-carry', 'write-off', 'salary-recovery')) NOT VALID;
ALTER TABLE "incentive_calc_adjustments" VALIDATE CONSTRAINT "incentive_calc_adjustments_kind_check";
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_target_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_target_check" CHECK (("kind" IN ('recalc-difference', 'negative-carry')) = ("to_month" IS NOT NULL)) NOT VALID;
ALTER TABLE "incentive_calc_adjustments" VALIDATE CONSTRAINT "incentive_calc_adjustments_target_check";

-- 0136's input-history entity check
ALTER TABLE "incentive_calc_input_history" DROP CONSTRAINT IF EXISTS "incentive_calc_input_history_entity_check";
ALTER TABLE "incentive_calc_input_history" ADD CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event', 'b-override', 'c-review')) NOT VALID;
ALTER TABLE "incentive_calc_input_history" VALIDATE CONSTRAINT "incentive_calc_input_history_entity_check";

-- 0136's settings list
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
  'g.consecutiveMonths', 'g.minMonthlyPurchase', 'g.purchaseBasis', 'g.rewardAmount', 'g.afterReward',
  'c.turnoverWindowMonths', 'c.turnoverBasis', 'payout.minimumPayable', 'payout.belowMinimum', 'payout.carryForwardExpiry', 'payout.carryForwardExpiryMonths'
  -- settings-key-list-end
)) NOT VALID;
ALTER TABLE "incentive_config_settings" VALIDATE CONSTRAINT "incentive_config_settings_key_check";
