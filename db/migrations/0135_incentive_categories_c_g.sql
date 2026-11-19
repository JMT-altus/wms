-- 0135 Incentive calculation — Categories C, D, E, F and G.
--
-- Depends on 0131–0134, which it extends; none of them is changed. Never apply through `pnpm db:migrate`; apply this
-- one file through its hash-pinned apply script, after 0134.
--
-- WHAT.
--   Incentive Rules settings: the database accepts Categories C–G's settings (lib/incentives/rules-config/spec.ts), and
--     a category's own settings (`c.*` … `g.*`) belong to that category's versions only; Category A's own settings and
--     slabs stay Category A's (0134's rule, now for every other category).
--   Calculation storage (0132): runs, periods and adjustments accept every category A–G. Approvals, payouts, payout
--     lines, the period guard and the append-only rules apply unchanged.
--   incentive_calc_items   per run: each credited item of Categories C–G — a new customer, a customer's run of
--                          purchases, an approved lead batch, enquiry conversion, meeting or testimonial — with what it
--                          earned and why. Append-only, like the run itself.
--
-- No existing row is changed. Checks are widened NOT VALID and then validated. RLS on with no policies and the REST
-- roles revoked, as for 0114 … 0134. Additive and safe to re-run.

-- ── Incentive Rules: the settings the database accepts ───────────────────────
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

-- A category's own settings (`x.*`) belong to its versions only; Category A's own settings never to another category.
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

-- ── Calculation storage: every category A–G ───────────────────────────────────
ALTER TABLE "incentive_calc_runs" DROP CONSTRAINT IF EXISTS "incentive_calc_runs_category_check";
ALTER TABLE "incentive_calc_runs" ADD CONSTRAINT "incentive_calc_runs_category_check" CHECK ("category_code" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')) NOT VALID;
ALTER TABLE "incentive_calc_runs" VALIDATE CONSTRAINT "incentive_calc_runs_category_check";
ALTER TABLE "incentive_calc_periods" DROP CONSTRAINT IF EXISTS "incentive_calc_periods_category_check";
ALTER TABLE "incentive_calc_periods" ADD CONSTRAINT "incentive_calc_periods_category_check" CHECK ("category_code" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')) NOT VALID;
ALTER TABLE "incentive_calc_periods" VALIDATE CONSTRAINT "incentive_calc_periods_category_check";
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_category_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_category_check" CHECK ("category_code" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')) NOT VALID;
ALTER TABLE "incentive_calc_adjustments" VALIDATE CONSTRAINT "incentive_calc_adjustments_category_check";

-- ── items of Categories C–G, per run ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "line_code" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "label" text NOT NULL,
  "share_ppm" integer NOT NULL,
  "base_exact" text NOT NULL,
  "earned_exact" text NOT NULL,
  "payable_exact" text NOT NULL,
  "multiplier_ppm" integer,
  "status" text NOT NULL,
  "explanation" jsonb NOT NULL,
  CONSTRAINT "incentive_calc_items_line_check" CHECK ("line_code" ~ '^[C-G]\.[0-9]$'),
  CONSTRAINT "incentive_calc_items_source_check" CHECK ("source_type" IN ('customer', 'lead-batch', 'lead-conversion', 'meeting', 'testimonial', 'month')),
  CONSTRAINT "incentive_calc_items_status_check" CHECK ("status" IN ('credited', 'pending')),
  CONSTRAINT "incentive_calc_items_share_check" CHECK ("share_ppm" BETWEEN 1 AND 1000000),
  CONSTRAINT "incentive_calc_items_multiplier_check" CHECK ("multiplier_ppm" IS NULL OR "multiplier_ppm" BETWEEN 0 AND 1000000),
  CONSTRAINT "incentive_calc_items_exact_check" CHECK ("base_exact" ~ '^-?[0-9]+(/[0-9]+)?$' AND "earned_exact" ~ '^-?[0-9]+(/[0-9]+)?$' AND "payable_exact" ~ '^-?[0-9]+(/[0-9]+)?$'),
  CONSTRAINT "incentive_calc_items_explanation_check" CHECK (jsonb_typeof("explanation") = 'array')
);
-- No item credited twice in one run to the same person.
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_items_uq" ON "incentive_calc_items" ("run_id", "employee_id", "line_code", "source_id");
CREATE INDEX IF NOT EXISTS "incentive_calc_items_run_idx" ON "incentive_calc_items" ("run_id", "employee_id");
DROP TRIGGER IF EXISTS "incentive_calc_items_no_change" ON "incentive_calc_items";
CREATE TRIGGER "incentive_calc_items_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_items" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id');

COMMENT ON TABLE "incentive_calc_items" IS 'Categories C–G: per run, each credited item (new customer, run of purchases, approved lead batch, conversion, meeting or testimonial) with what it earned and why. Append-only.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_items" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_calc_items FROM %I', r);
    END IF;
  END LOOP;
END
$$;
