-- 0136 Incentive calculation — Category C corrections: Admin Review decisions on unmatched records, the settings for
-- net turnover, the rolling turnover window, receipt-based collection and the minimum payable, the below-minimum
-- carry-forward ledger, and voided (abandoned, unpaid) months.
--
-- Depends on 0131–0135, which it extends; none of them is changed. Never apply through pnpm db:migrate; apply this
-- one file through its hash-pinned apply runner (scripts/incentive-0136), after 0135. Its rollback is
-- db/rollback/0136_incentive_category_c_review.rollback.sql, run only through its own hash-pinned runner.
--
-- WHAT.
--   Incentive Rules settings (incentive_config_settings_key_check, widened NOT VALID then validated): six new keys —
--     c.turnoverWindowMonths, c.turnoverBasis, payout.minimumPayable, payout.belowMinimum, payout.carryForwardExpiry,
--     payout.carryForwardExpiryMonths. The settings-by-category function (replaced) lets Category C, and no other
--     category, use three of Category A's settings — collection.payableWhen, adjust.creditNote, adjust.salesReturn — and
--     keeps the four payout.* minimum-payable settings Category C's only. Category A's other settings stay Category A's;
--     c.* … g.* keys stay their own category's.
--   incentive_calc_c_reviews   an authorised admin's decision on an unmatched Category C record, by case:
--                                order-customer       a Sales Order without a Customer Master link → a customer
--                                invoice-order        an invoice without (or naming a missing) Sales Order → a Sales Order
--                                credit-note-invoice  a credit note without an invoice → an invoice
--                                return-credit-note   a sales return not on a credit note → a credit note
--                                receipt-customer     a receipt without a customer, or for another customer → a customer
--                              LINK it (to a target of the right kind, checked by trigger) or EXCLUDE it, always with a
--                              reason. A decision never qualifies anything by itself; the next calculation applies it.
--                              Retire-only (0133's input guard); one ACTIVE decision per record and case; each recorded
--                              and retired in the input history (entity 'c-review', widened NOT VALID then validated).
--   Separation of duties: whoever recorded or retired a decision on a record of a Category C month's calculation never
--     approves or rejects that month (a new trigger on incentive_calc_approvals; 0133's and 0134's checks still apply).
--   incentive_calc_carry       the below-minimum carry-forward ledger, append-only: a HELD lot (amount > 0) per
--                              salesperson per payout — unique by employee identity, never by name — written when a
--                              month whose total is below the minimum is paid; later payouts consume it as released,
--                              offset or expired, each KIND at most once per lot per payout (an offset and an expiry of
--                              one lot may share a payout); an authorised write-off needs a reason. A trigger, under an
--                              advisory lock per lot, refuses taking more than remains or a lot of another programme,
--                              category or salesperson.
--   incentive_calc_period_voids a voided month, append-only, one per period: only an OPEN or LOCKED month (checked by
--                              trigger under the period's row lock, so a submission or payout can't happen at the same
--                              moment), with the reason, who, and a summary of what was carried into the next month. The
--                              month's runs and history stay; it no longer holds up later months.
--
-- No existing row is changed. Checks are widened NOT VALID and then validated. The three new tables have RLS on with
-- no policies and the REST roles revoked, as for 0114 … 0135. Additive and safe to re-run.

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
  'g.consecutiveMonths', 'g.minMonthlyPurchase', 'g.purchaseBasis', 'g.rewardAmount', 'g.afterReward',
  'c.turnoverWindowMonths', 'c.turnoverBasis', 'payout.minimumPayable', 'payout.belowMinimum', 'payout.carryForwardExpiry', 'payout.carryForwardExpiryMonths'
  -- settings-key-list-end
)) NOT VALID;
ALTER TABLE "incentive_config_settings" VALIDATE CONSTRAINT "incentive_config_settings_key_check";

-- A category's own settings (`x.*`) belong to its versions only; Category A's own settings never to another category,
-- except the three Category C shares; the minimum-payable settings are Category C's (and nobody else's) for now.
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
    'basis.document', 'basis.amount', 'basis.monthDate', 'basis.preClosure', 'basis.categoryBOrders', 'eligibility.threshold', 'eligibility.thresholdComparison', 'slabs.method', 'slabs.boundaries', 'slabs.aboveTop', 'slabs.aboveTopAmount', 'slabs.gaps', 'allocation.method', 'allocation.eligibleOrders', 'allocation.minOrderAmount'
  ) THEN
    RAISE EXCEPTION 'Setting % isn''t a Category % setting', NEW."setting_key", c USING ERRCODE = 'check_violation';
  END IF;
  IF c IS DISTINCT FROM 'A' AND c IS DISTINCT FROM 'C' AND NEW."setting_key" IN ('collection.payableWhen', 'adjust.creditNote', 'adjust.salesReturn') THEN
    RAISE EXCEPTION 'Setting % isn''t a Category % setting', NEW."setting_key", c USING ERRCODE = 'check_violation';
  END IF;
  IF c IS DISTINCT FROM 'C' AND NEW."setting_key" IN ('payout.minimumPayable', 'payout.belowMinimum', 'payout.carryForwardExpiry', 'payout.carryForwardExpiryMonths') THEN
    RAISE EXCEPTION 'Setting % isn''t a Category % setting', NEW."setting_key", c USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ── Category C: decisions on unmatched records ───────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_c_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "tally_documents"("id") ON DELETE RESTRICT,
  "case_kind" text NOT NULL,
  "decision" text NOT NULL,
  "target_id" uuid,
  "reason" text NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz,
  "retired_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "retired_reason" text,
  CONSTRAINT "incentive_calc_c_reviews_kind_check" CHECK ("case_kind" IN ('order-customer', 'invoice-order', 'credit-note-invoice', 'return-credit-note', 'receipt-customer')),
  CONSTRAINT "incentive_calc_c_reviews_decision_check" CHECK ("decision" IN ('link', 'exclude')),
  CONSTRAINT "incentive_calc_c_reviews_target_check" CHECK (("decision" = 'link') = ("target_id" IS NOT NULL)),
  CONSTRAINT "incentive_calc_c_reviews_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
  CONSTRAINT "incentive_calc_c_reviews_name_check" CHECK (length(btrim("created_by_name")) BETWEEN 1 AND 200),
  CONSTRAINT "incentive_calc_c_reviews_retired_check" CHECK (("retired_at" IS NULL AND "retired_reason" IS NULL) OR ("retired_at" IS NOT NULL AND length(btrim(coalesce("retired_reason", ''))) BETWEEN 1 AND 1000))
);
-- One ACTIVE decision per record and case (retired ones stay as history).
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_c_reviews_active_uq" ON "incentive_calc_c_reviews" ("document_id", "case_kind") WHERE "retired_at" IS NULL;
CREATE INDEX IF NOT EXISTS "incentive_calc_c_reviews_document_idx" ON "incentive_calc_c_reviews" ("document_id", "created_at");

-- The record and its link target must be of the right kind: an order links to a Customer Master record, an invoice to
-- a Sales Order, a credit note to a sales invoice, a sales return to a credit note.
CREATE OR REPLACE FUNCTION "incentive_calc_c_reviews_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_c_reviews'), hashtext(NEW."document_id"::text || '|' || NEW."case_kind"));
  SELECT "document_type" INTO t FROM "tally_documents" WHERE "id" = NEW."document_id";
  IF t IS NULL
     OR (NEW."case_kind" = 'order-customer' AND t <> 'sales-orders')
     OR (NEW."case_kind" = 'invoice-order' AND t <> 'sales-invoices')
     OR (NEW."case_kind" = 'credit-note-invoice' AND t <> 'credit-notes')
     OR (NEW."case_kind" = 'receipt-customer' AND t <> 'customer-receipts') THEN
    RAISE EXCEPTION 'A Category C review decision names a Forms record of the kind its case is about' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."target_id" IS NOT NULL AND NOT (
       (NEW."case_kind" = 'order-customer' AND EXISTS (SELECT 1 FROM "customer_masters" WHERE "id" = NEW."target_id"))
    OR (NEW."case_kind" = 'invoice-order' AND EXISTS (SELECT 1 FROM "tally_documents" WHERE "id" = NEW."target_id" AND "document_type" = 'sales-orders'))
    OR (NEW."case_kind" = 'credit-note-invoice' AND EXISTS (SELECT 1 FROM "tally_documents" WHERE "id" = NEW."target_id" AND "document_type" = 'sales-invoices'))
    OR (NEW."case_kind" = 'return-credit-note' AND EXISTS (SELECT 1 FROM "tally_documents" WHERE "id" = NEW."target_id" AND "document_type" = 'credit-notes'))
    OR (NEW."case_kind" = 'receipt-customer' AND EXISTS (SELECT 1 FROM "customer_masters" WHERE "id" = NEW."target_id"))
  ) THEN
    RAISE EXCEPTION 'A Category C review decision links a record only to what it belongs to (a customer, Sales Order, invoice or credit note)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."retired_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A review decision is recorded active and retired later' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_c_reviews_insert" ON "incentive_calc_c_reviews";
CREATE TRIGGER "incentive_calc_c_reviews_insert" BEFORE INSERT ON "incentive_calc_c_reviews" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_c_reviews_check"();
-- Retire-only (0133's input guard): never edited, never deleted.
DROP TRIGGER IF EXISTS "incentive_calc_c_reviews_guard" ON "incentive_calc_c_reviews";
CREATE TRIGGER "incentive_calc_c_reviews_guard" BEFORE UPDATE OR DELETE ON "incentive_calc_c_reviews" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_input_guard"();

-- ── input history records review decisions ────────────────────────────────────
ALTER TABLE "incentive_calc_input_history" DROP CONSTRAINT IF EXISTS "incentive_calc_input_history_entity_check";
ALTER TABLE "incentive_calc_input_history" ADD CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event', 'b-override', 'c-review')) NOT VALID;
ALTER TABLE "incentive_calc_input_history" VALIDATE CONSTRAINT "incentive_calc_input_history_entity_check";

-- ── separation of duties ──────────────────────────────────────────────────────
-- Whoever recorded or retired a review decision on any record of a Category C month's calculation (its stored inputs)
-- never approves or rejects that month.
CREATE OR REPLACE FUNCTION "incentive_calc_c_approvals_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."actor_id" IS NOT NULL AND (SELECT "category_code" FROM "incentive_calc_periods" WHERE "id" = NEW."period_id") = 'C' AND EXISTS (
    SELECT 1 FROM "incentive_calc_runs" run
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(run."inputs"->'orders', '[]'::jsonb) || coalesce(run."inputs"->'invoices', '[]'::jsonb) || coalesce(run."inputs"->'creditNotes', '[]'::jsonb) || coalesce(run."inputs"->'receipts', '[]'::jsonb)) d
    JOIN "incentive_calc_c_reviews" r ON r."document_id"::text = d->>'id'
    WHERE run."id" = NEW."run_id" AND (r."created_by_id" = NEW."actor_id" OR r."retired_by_id" = NEW."actor_id")
  ) THEN
    RAISE EXCEPTION 'Whoever decided a Category C review case of a month never approves or rejects that month' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_c_approvals_insert" ON "incentive_calc_approvals";
CREATE TRIGGER "incentive_calc_c_approvals_insert" BEFORE INSERT ON "incentive_calc_approvals" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_c_approvals_check"();

-- ── below-minimum carry-forward ledger ────────────────────────────────────────
-- A salesperson's month whose total is below the configured smallest amount is HELD: a lot (kind 'held', amount > 0),
-- written when that month's payout is recorded. A later month's payout CONSUMES lots — released (paid in that month),
-- offset (absorbed a recovery), expired (as the configuration says) — and an authorised person may write one off
-- (kind 'written-off', reason required). A lot's remaining amount never goes below zero; nothing is edited or deleted;
-- each kind of use of a lot is recorded at most once per payout. Category C uses it first (payout.minimumPayable).
CREATE TABLE IF NOT EXISTS "incentive_calc_carry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "incentive_programs"("id") ON DELETE RESTRICT,
  "category_code" text NOT NULL,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "employee_name" text NOT NULL,
  "month" date NOT NULL,
  "kind" text NOT NULL,
  "amount_paise" bigint NOT NULL,
  "lot_id" uuid REFERENCES "incentive_calc_carry"("id") ON DELETE RESTRICT,
  "period_id" uuid REFERENCES "incentive_calc_periods"("id") ON DELETE RESTRICT,
  "run_id" uuid REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "reason" text,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_carry_category_check" CHECK ("category_code" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')),
  CONSTRAINT "incentive_calc_carry_kind_check" CHECK ("kind" IN ('held', 'released', 'offset', 'expired', 'written-off')),
  CONSTRAINT "incentive_calc_carry_month_check" CHECK (extract(day FROM "month") = 1),
  CONSTRAINT "incentive_calc_carry_shape_check" CHECK (
    ("kind" = 'held' AND "lot_id" IS NULL AND "amount_paise" > 0 AND "period_id" IS NOT NULL AND "run_id" IS NOT NULL)
    OR ("kind" IN ('released', 'offset', 'expired') AND "lot_id" IS NOT NULL AND "amount_paise" < 0 AND "period_id" IS NOT NULL AND "run_id" IS NOT NULL)
    OR ("kind" = 'written-off' AND "lot_id" IS NOT NULL AND "amount_paise" < 0 AND length(btrim(coalesce("reason", ''))) BETWEEN 1 AND 1000)
  ),
  CONSTRAINT "incentive_calc_carry_name_check" CHECK (length(btrim("employee_name")) BETWEEN 1 AND 200 AND length(btrim("created_by_name")) BETWEEN 1 AND 200)
);
-- A month's payout holds at most one lot per salesperson (by stable identity — two people may share a name; a row whose
-- employee was later deleted keeps its name and no longer collides), and records each KIND of use of a lot at most once
-- (an offset and an expiry of the same lot in one payout are two rows; the trigger caps their total at what remains).
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_carry_held_uq" ON "incentive_calc_carry" ("period_id", "employee_id") WHERE "kind" = 'held' AND "employee_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_carry_consume_uq" ON "incentive_calc_carry" ("lot_id", "period_id", "kind") WHERE "lot_id" IS NOT NULL AND "period_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "incentive_calc_carry_employee_idx" ON "incentive_calc_carry" ("program_id", "category_code", "employee_id", "month");
CREATE INDEX IF NOT EXISTS "incentive_calc_carry_lot_idx" ON "incentive_calc_carry" ("lot_id");

-- A consuming entry names a held lot of the same programme, category and salesperson, and never takes more than remains.
CREATE OR REPLACE FUNCTION "incentive_calc_carry_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lot record;
  remaining bigint;
BEGIN
  IF NEW."lot_id" IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_carry'), hashtext(NEW."lot_id"::text));
  SELECT * INTO lot FROM "incentive_calc_carry" WHERE "id" = NEW."lot_id";
  IF lot IS NULL OR lot."kind" <> 'held' OR lot."program_id" <> NEW."program_id" OR lot."category_code" <> NEW."category_code" OR lot."employee_id" IS DISTINCT FROM NEW."employee_id" THEN
    RAISE EXCEPTION 'A carry-forward entry consumes a held amount of the same programme, category and salesperson' USING ERRCODE = 'check_violation';
  END IF;
  SELECT lot."amount_paise" + coalesce(sum(c."amount_paise"), 0) INTO remaining FROM "incentive_calc_carry" c WHERE c."lot_id" = NEW."lot_id";
  IF remaining + NEW."amount_paise" < 0 THEN
    RAISE EXCEPTION 'A carried-forward amount is used only once: % paise remain, % asked', remaining, -NEW."amount_paise" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_carry_insert" ON "incentive_calc_carry";
CREATE TRIGGER "incentive_calc_carry_insert" BEFORE INSERT ON "incentive_calc_carry" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_carry_check"();
-- Append-only (0132's rule): never edited or deleted; only a deleted employee's or recorder's link may become null.
DROP TRIGGER IF EXISTS "incentive_calc_carry_no_change" ON "incentive_calc_carry";
CREATE TRIGGER "incentive_calc_carry_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_carry" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id', 'created_by_id');

COMMENT ON TABLE "incentive_calc_carry" IS 'Below-minimum carry-forward ledger: held lots and their release / offset / expiry / write-off, written when payouts are recorded (or by an authorised write-off with its reason). Append-only.';

-- ── void month ────────────────────────────────────────────────────────────────
-- An abandoned, UNPAID month (open or locked; never submitted, approved or paid) voided by an authorised person with a
-- reason: it no longer blocks later months. Its calculation runs stay; its amounts are carried to the next open month
-- (recorded as adjustments) before it is voided, and the balances it counted were never consumed. One void per month;
-- never edited or deleted.
CREATE TABLE IF NOT EXISTS "incentive_calc_period_voids" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "period_id" uuid NOT NULL REFERENCES "incentive_calc_periods"("id") ON DELETE RESTRICT,
  "run_id" uuid REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "carried_to_month" date,
  "summary" jsonb NOT NULL,
  "reason" text NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_period_voids_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
  CONSTRAINT "incentive_calc_period_voids_name_check" CHECK (length(btrim("created_by_name")) BETWEEN 1 AND 200),
  CONSTRAINT "incentive_calc_period_voids_month_check" CHECK ("carried_to_month" IS NULL OR extract(day FROM "carried_to_month") = 1),
  CONSTRAINT "incentive_calc_period_voids_summary_check" CHECK (jsonb_typeof("summary") = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_period_voids_period_uq" ON "incentive_calc_period_voids" ("period_id");
-- Only a month that is open or locked is voided (checked under the period's row lock: a payout or submission can't
-- happen at the same moment).
CREATE OR REPLACE FUNCTION "incentive_calc_period_voids_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  SELECT "status" INTO s FROM "incentive_calc_periods" WHERE "id" = NEW."period_id" FOR UPDATE;
  IF s IS NULL OR s NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Only an open or locked month is voided (this one is %)', coalesce(s, 'missing') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_period_voids_insert" ON "incentive_calc_period_voids";
CREATE TRIGGER "incentive_calc_period_voids_insert" BEFORE INSERT ON "incentive_calc_period_voids" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_period_voids_check"();
DROP TRIGGER IF EXISTS "incentive_calc_period_voids_no_change" ON "incentive_calc_period_voids";
CREATE TRIGGER "incentive_calc_period_voids_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_period_voids" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('created_by_id');
COMMENT ON TABLE "incentive_calc_period_voids" IS 'An abandoned unpaid month voided by an authorised person, with the reason and a summary of what was carried forward. Append-only.';

COMMENT ON TABLE "incentive_calc_c_reviews" IS 'Category C: an authorised admin''s decision on an unmatched record (link it to the customer, order, invoice or credit note it belongs to, or exclude it), with its reason. Never qualifies anything by itself. Retire-only; one active decision per record and case.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_c_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_carry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_period_voids" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_calc_c_reviews FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_calc_carry FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_calc_period_voids FROM %I', r);
    END IF;
  END LOOP;
END
$$;
