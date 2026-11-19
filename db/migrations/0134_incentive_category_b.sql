-- 0134 Incentive calculation — Category B (Old Customer – New Product / New Brand).
--
-- Depends on 0131, 0132 and 0133, which it extends; none of them is changed. Never apply through `pnpm db:migrate`;
-- apply this one file through its hash-pinned apply script, after 0133.
--
-- WHAT.
--   Incentive Rules settings: the database accepts Category B's settings and the optional Category A / shared ones
--     (lib/incentives/rules-config/spec.ts), and a setting or a slab belongs to the categories that use it: `b.*` only
--     on Category B versions, Category A's own settings and slabs only on Category A versions.
--   Calculation storage (0132): runs, periods and adjustments accept Category B as well as A. Everything else of 0132
--     and 0133 (results, credits, approvals, payouts, the period guard, append-only rules) applies to B unchanged.
--   incentive_calc_b_overrides        an authorised admin's manual decision that a Sales Order qualifies for Category B,
--                                     or doesn't, with its reason. Never edited or deleted: retired (who, when, why) and
--                                     recorded again. One active decision per Sales Order.
--   incentive_calc_b_qualifications  per run and Sales Order: the outcome (qualified / not qualified / needs review),
--                                     the automatic outcome beside any override, the qualifying invoice and the evidence
--                                     (earlier orders, new products and brands, unmatched records, credit notes).
--                                     Append-only, like the run itself.
--   incentive_calc_input_history     records override changes too (entity 'b-override').
--   Separation of duties: whoever recorded or retired an override on any Sales Order of a Category B month's
--     calculation never approves or rejects that month.
--
-- No existing row is changed. Constraints are widened, never narrowed; the widened checks are added NOT VALID and then
-- validated (every existing row already satisfies them). RLS on with no policies and the REST roles revoked, as for
-- 0114 … 0133. Additive and safe to re-run.

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
  'b.salesReturns', 'b.recoveryExpiry'
  -- settings-key-list-end
)) NOT VALID;
ALTER TABLE "incentive_config_settings" VALIDATE CONSTRAINT "incentive_config_settings_key_check";

-- A setting belongs to the categories that use it; slabs are Category A's only.
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
DROP TRIGGER IF EXISTS "incentive_config_settings_category" ON "incentive_config_settings";
CREATE TRIGGER "incentive_config_settings_category" BEFORE INSERT OR UPDATE ON "incentive_config_settings" FOR EACH ROW EXECUTE FUNCTION "incentive_config_settings_category_check"();

CREATE OR REPLACE FUNCTION "incentive_config_slabs_category_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "category_code" FROM "incentive_config_versions" WHERE "id" = NEW."version_id") IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'Only Category A versions have incentive slabs' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_config_slabs_category" ON "incentive_config_slabs";
CREATE TRIGGER "incentive_config_slabs_category" BEFORE INSERT OR UPDATE ON "incentive_config_slabs" FOR EACH ROW EXECUTE FUNCTION "incentive_config_slabs_category_check"();

-- ── Calculation storage: Category B joins Category A ─────────────────────────
ALTER TABLE "incentive_calc_runs" DROP CONSTRAINT IF EXISTS "incentive_calc_runs_category_check";
ALTER TABLE "incentive_calc_runs" ADD CONSTRAINT "incentive_calc_runs_category_check" CHECK ("category_code" IN ('A', 'B')) NOT VALID;
ALTER TABLE "incentive_calc_runs" VALIDATE CONSTRAINT "incentive_calc_runs_category_check";
ALTER TABLE "incentive_calc_periods" DROP CONSTRAINT IF EXISTS "incentive_calc_periods_category_check";
ALTER TABLE "incentive_calc_periods" ADD CONSTRAINT "incentive_calc_periods_category_check" CHECK ("category_code" IN ('A', 'B')) NOT VALID;
ALTER TABLE "incentive_calc_periods" VALIDATE CONSTRAINT "incentive_calc_periods_category_check";
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_category_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_category_check" CHECK ("category_code" IN ('A', 'B')) NOT VALID;
ALTER TABLE "incentive_calc_adjustments" VALIDATE CONSTRAINT "incentive_calc_adjustments_category_check";

-- ── manual qualification decisions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_b_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_document_id" uuid NOT NULL REFERENCES "tally_documents"("id") ON DELETE RESTRICT,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz,
  "retired_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "retired_reason" text,
  CONSTRAINT "incentive_calc_b_overrides_decision_check" CHECK ("decision" IN ('qualify', 'exclude')),
  CONSTRAINT "incentive_calc_b_overrides_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
  CONSTRAINT "incentive_calc_b_overrides_name_check" CHECK (length(btrim("created_by_name")) BETWEEN 1 AND 200),
  CONSTRAINT "incentive_calc_b_overrides_retired_check" CHECK (("retired_at" IS NULL AND "retired_reason" IS NULL) OR ("retired_at" IS NOT NULL AND length(btrim(coalesce("retired_reason", ''))) BETWEEN 1 AND 1000))
);
-- One ACTIVE decision per Sales Order (retired ones stay as history).
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_b_overrides_active_uq" ON "incentive_calc_b_overrides" ("order_document_id") WHERE "retired_at" IS NULL;
CREATE INDEX IF NOT EXISTS "incentive_calc_b_overrides_order_idx" ON "incentive_calc_b_overrides" ("order_document_id", "created_at");

CREATE OR REPLACE FUNCTION "incentive_calc_b_overrides_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_b_overrides'), hashtext(NEW."order_document_id"::text));
  IF NOT EXISTS (SELECT 1 FROM "tally_documents" WHERE "id" = NEW."order_document_id" AND "document_type" = 'sales-orders') THEN
    RAISE EXCEPTION 'A Category B qualification decision is recorded on a Forms Sales Order' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."retired_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A qualification decision is recorded active and retired later' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_b_overrides_insert" ON "incentive_calc_b_overrides";
CREATE TRIGGER "incentive_calc_b_overrides_insert" BEFORE INSERT ON "incentive_calc_b_overrides" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_b_overrides_check"();
-- Retire-only (0133's input guard): never edited, never deleted.
DROP TRIGGER IF EXISTS "incentive_calc_b_overrides_guard" ON "incentive_calc_b_overrides";
CREATE TRIGGER "incentive_calc_b_overrides_guard" BEFORE UPDATE OR DELETE ON "incentive_calc_b_overrides" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_input_guard"();

-- ── qualification evidence, per run ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_b_qualifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "order_document_id" uuid REFERENCES "tally_documents"("id") ON DELETE SET NULL,
  "order_no" text NOT NULL,
  "order_date" date NOT NULL,
  "customer_master_id" uuid REFERENCES "customer_masters"("id") ON DELETE SET NULL,
  "customer_name" text,
  "outcome" text NOT NULL,
  "automatic_outcome" text NOT NULL,
  "override_id" uuid REFERENCES "incentive_calc_b_overrides"("id") ON DELETE RESTRICT,
  "override_decision" text,
  "override_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "invoice_document_id" uuid REFERENCES "tally_documents"("id") ON DELETE SET NULL,
  "invoice_no" text,
  "invoice_date" date,
  "invoice_month" date,
  "taxable_paise" bigint,
  "net_taxable_paise" bigint,
  "base_exact" text,
  "in_month" boolean NOT NULL,
  "pinned" boolean NOT NULL DEFAULT false,
  "reasons" jsonb NOT NULL,
  "evidence" jsonb NOT NULL,
  CONSTRAINT "incentive_calc_b_qualifications_outcome_check" CHECK ("outcome" IN ('qualified', 'not-qualified', 'needs-review') AND "automatic_outcome" IN ('qualified', 'not-qualified', 'needs-review')),
  CONSTRAINT "incentive_calc_b_qualifications_override_check" CHECK (("override_id" IS NULL) = ("override_decision" IS NULL) AND ("override_decision" IS NULL OR "override_decision" IN ('qualify', 'exclude'))),
  CONSTRAINT "incentive_calc_b_qualifications_month_check" CHECK ("invoice_month" IS NULL OR extract(day FROM "invoice_month") = 1),
  CONSTRAINT "incentive_calc_b_qualifications_exact_check" CHECK ("base_exact" IS NULL OR "base_exact" ~ '^-?[0-9]+(/[0-9]+)?$'),
  CONSTRAINT "incentive_calc_b_qualifications_reasons_check" CHECK (jsonb_typeof("reasons") = 'array' AND jsonb_typeof("evidence") = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_b_qualifications_uq" ON "incentive_calc_b_qualifications" ("run_id", "order_document_id");
CREATE INDEX IF NOT EXISTS "incentive_calc_b_qualifications_order_idx" ON "incentive_calc_b_qualifications" ("order_document_id");
DROP TRIGGER IF EXISTS "incentive_calc_b_qualifications_no_change" ON "incentive_calc_b_qualifications";
CREATE TRIGGER "incentive_calc_b_qualifications_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_b_qualifications" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('order_document_id', 'customer_master_id', 'override_by_id', 'invoice_document_id');

-- ── input history records override changes ────────────────────────────────────
ALTER TABLE "incentive_calc_input_history" DROP CONSTRAINT IF EXISTS "incentive_calc_input_history_entity_check";
ALTER TABLE "incentive_calc_input_history" ADD CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event', 'b-override')) NOT VALID;
ALTER TABLE "incentive_calc_input_history" VALIDATE CONSTRAINT "incentive_calc_input_history_entity_check";

-- ── separation of duties ──────────────────────────────────────────────────────
-- Whoever recorded or retired a qualification decision on any Sales Order of a Category B month's calculation never
-- approves or rejects that month (0133's own approval checks still apply as well).
CREATE OR REPLACE FUNCTION "incentive_calc_b_approvals_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "category_code" FROM "incentive_calc_periods" WHERE "id" = NEW."period_id") = 'B' AND EXISTS (
    SELECT 1 FROM "incentive_calc_b_qualifications" q
    JOIN "incentive_calc_b_overrides" o ON o."order_document_id" = q."order_document_id"
    WHERE q."run_id" = NEW."run_id" AND NEW."actor_id" IS NOT NULL AND (o."created_by_id" = NEW."actor_id" OR o."retired_by_id" = NEW."actor_id")
  ) THEN
    RAISE EXCEPTION 'Whoever decided a Sales Order''s Category B qualification by hand never approves or rejects that month' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_b_approvals_insert" ON "incentive_calc_approvals";
CREATE TRIGGER "incentive_calc_b_approvals_insert" BEFORE INSERT ON "incentive_calc_approvals" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_b_approvals_check"();

-- ── descriptions ──────────────────────────────────────────────────────────────
COMMENT ON TABLE "incentive_calc_b_overrides" IS 'Category B: an authorised admin''s manual decision that a Forms Sales Order qualifies (or doesn''t), with its reason. Retire-only; one active decision per order.';
COMMENT ON TABLE "incentive_calc_b_qualifications" IS 'Category B: per run and Sales Order, the outcome (qualified / not qualified / needs review), the automatic outcome beside any override, the qualifying invoice and the evidence. Append-only.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_b_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_b_qualifications" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['incentive_calc_b_overrides', 'incentive_calc_b_qualifications'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
