-- 0137 Incentive calculation — Category F (Google reviews): the review registry with database-enforced uniqueness,
-- each salesperson's submission, append-only verification / attribution / invalidation decisions, the two-person
-- recovery write-off, Category F's new settings, and history that survives an employee's deletion.
--
-- Depends on 0131–0136, which it extends. Never apply through pnpm db:migrate; apply this one file through its hash-pinned
-- runner (scripts/incentive-0137), after 0136. Its rollback (db/rollback/0137_incentive_category_f_reviews.rollback.sql)
-- runs only through the same runner and refuses while any Category F data exists.
--
-- WHAT.
--   Settings (key check widened NOT VALID, then validated): f.namedBonusAmount, f.minRating, f.minQualifyingReviews,
--     f.recoveryExpiry. They are f.* keys, so the existing settings-by-category trigger keeps them Category F's only.
--   Input history: entity 'f-decision'.
--   Adjustments: kind 'recovery-write-off' — a POSITIVE amount carried into the month a Category F recovery is taken
--     from, settling exactly the written-off part of it (approved by a second person; one per recovered balance).
--   testimonials (the old engine's table): employee_id becomes NULLABLE with ON DELETE SET NULL (was CASCADE), and a new
--     employee_name keeps who submitted it (filled now for every row, and on every insert): deleting an employee never
--     deletes their testimonials again. Nothing else about the old engine changes.
--   incentive_f_reviews       one row per UNIQUE Google review: its Google review ID and / or normalised URL, each
--                             UNIQUE; append-only. Room for the Google Business Profile API (source, place_id).
--   incentive_f_submissions   each salesperson's claim (URL, screenshot, claimed date, rating, text): new, a duplicate of
--                             a review already registered, or unresolved (a short link: Admin Review). Append-only.
--   incentive_f_decisions     verify / reject / needs-review / link / attribute (retire-only, reason required) and
--                             invalidate-request / -approve / -refuse (permanent; a different person approves). Triggers
--                             refuse a submitter deciding their own review, a second active decision, an attribution
--                             outside the priority, a self-approved invalidation.
--   incentive_f_writeoffs     request / approve / refuse of a recovery write-off (a different person approves; one per
--                             balance; never more than remains).
--   Separation of duties: whoever decided a review in a Category F month's calculation never approves or rejects that month.
--
-- No existing row is changed except testimonials.employee_name being filled. RLS on, no policies, REST roles revoked.
-- Safe to re-run.

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
  'c.turnoverWindowMonths', 'c.turnoverBasis', 'payout.minimumPayable', 'payout.belowMinimum', 'payout.carryForwardExpiry', 'payout.carryForwardExpiryMonths',
  'f.namedBonusAmount', 'f.minRating', 'f.minQualifyingReviews', 'f.recoveryExpiry'
  -- settings-key-list-end
)) NOT VALID;
ALTER TABLE "incentive_config_settings" VALIDATE CONSTRAINT "incentive_config_settings_key_check";

-- ── input history records Category F decisions ────────────────────────────────
ALTER TABLE "incentive_calc_input_history" DROP CONSTRAINT IF EXISTS "incentive_calc_input_history_entity_check";
ALTER TABLE "incentive_calc_input_history" ADD CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event', 'b-override', 'c-review', 'f-decision')) NOT VALID;
ALTER TABLE "incentive_calc_input_history" VALIDATE CONSTRAINT "incentive_calc_input_history_entity_check";

-- ── adjustments: a two-person recovery write-off ─────────────────────────────
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_kind_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_kind_check" CHECK ("kind" IN ('recalc-difference', 'negative-carry', 'write-off', 'salary-recovery', 'recovery-write-off')) NOT VALID;
ALTER TABLE "incentive_calc_adjustments" VALIDATE CONSTRAINT "incentive_calc_adjustments_kind_check";
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_target_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_target_check" CHECK (("kind" IN ('recalc-difference', 'negative-carry', 'recovery-write-off')) = ("to_month" IS NOT NULL)) NOT VALID;
ALTER TABLE "incentive_calc_adjustments" VALIDATE CONSTRAINT "incentive_calc_adjustments_target_check";
ALTER TABLE "incentive_calc_adjustments" DROP CONSTRAINT IF EXISTS "incentive_calc_adjustments_writeoff_check";
ALTER TABLE "incentive_calc_adjustments" ADD CONSTRAINT "incentive_calc_adjustments_writeoff_check" CHECK ("kind" <> 'recovery-write-off' OR ("amount_paise" > 0 AND "category_code" = 'F')) NOT VALID;
ALTER TABLE "incentive_calc_adjustments" VALIDATE CONSTRAINT "incentive_calc_adjustments_writeoff_check";

-- ── testimonials: history survives an employee's deletion ─────────────────────
ALTER TABLE "testimonials" ADD COLUMN IF NOT EXISTS "employee_name" text;
UPDATE "testimonials" t SET "employee_name" = e."name" FROM "employees" e WHERE e."id" = t."employee_id" AND t."employee_name" IS NULL;
CREATE OR REPLACE FUNCTION "testimonials_employee_name_fill"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."employee_name" IS NULL AND NEW."employee_id" IS NOT NULL THEN
    SELECT "name" INTO NEW."employee_name" FROM "employees" WHERE "id" = NEW."employee_id";
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "testimonials_employee_name" ON "testimonials";
CREATE TRIGGER "testimonials_employee_name" BEFORE INSERT OR UPDATE OF "employee_id" ON "testimonials" FOR EACH ROW EXECUTE FUNCTION "testimonials_employee_name_fill"();
ALTER TABLE "testimonials" ALTER COLUMN "employee_id" DROP NOT NULL;
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'public.testimonials'::regclass AND con.contype = 'f' AND con.confrelid = 'public.employees'::regclass
      AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.testimonials'::regclass AND a.attname = 'employee_id')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.testimonials DROP CONSTRAINT %I', c);
  END LOOP;
END
$$;
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL;
ALTER TABLE "testimonials" DROP CONSTRAINT IF EXISTS "testimonials_employee_named_check";
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_employee_named_check" CHECK ("employee_id" IS NOT NULL OR "employee_name" IS NOT NULL) NOT VALID;
ALTER TABLE "testimonials" VALIDATE CONSTRAINT "testimonials_employee_named_check";

-- ── the Google review registry ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_f_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "google_review_id" text,
  "url_key" text,
  "first_url" text NOT NULL,
  "place_id" text,
  "source" text NOT NULL DEFAULT 'manual',
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_f_reviews_identity_check" CHECK ("google_review_id" IS NOT NULL OR "url_key" IS NOT NULL),
  CONSTRAINT "incentive_f_reviews_source_check" CHECK ("source" IN ('manual', 'api')),
  CONSTRAINT "incentive_f_reviews_text_check" CHECK (length("first_url") BETWEEN 1 AND 2000 AND length(btrim("created_by_name")) BETWEEN 1 AND 200
    AND ("google_review_id" IS NULL OR length("google_review_id") BETWEEN 4 AND 300) AND ("url_key" IS NULL OR length("url_key") BETWEEN 4 AND 2000))
);
-- A Google review is registered ONCE, by its review ID and by its normalised URL (across every employee).
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_reviews_review_id_uq" ON "incentive_f_reviews" ("google_review_id") WHERE "google_review_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_reviews_url_uq" ON "incentive_f_reviews" ("url_key") WHERE "url_key" IS NOT NULL;
DROP TRIGGER IF EXISTS "incentive_f_reviews_no_change" ON "incentive_f_reviews";
CREATE TRIGGER "incentive_f_reviews_no_change" BEFORE UPDATE OR DELETE ON "incentive_f_reviews" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('created_by_id');

-- ── each salesperson's submission ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_f_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "testimonial_id" uuid REFERENCES "testimonials"("id") ON DELETE SET NULL,
  "review_id" uuid REFERENCES "incentive_f_reviews"("id") ON DELETE RESTRICT,
  "link_state" text NOT NULL,
  "submitted_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "submitted_by_name" text NOT NULL,
  "submitted_url" text NOT NULL,
  "url_key" text,
  "google_review_id" text,
  "screenshot_url" text,
  "claimed_rating" smallint NOT NULL,
  "claimed_published_on" date NOT NULL,
  "claimed_text" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_f_submissions_state_check" CHECK ("link_state" IN ('new', 'duplicate', 'unresolved') AND (("link_state" = 'unresolved') = ("review_id" IS NULL))),
  CONSTRAINT "incentive_f_submissions_rating_check" CHECK ("claimed_rating" BETWEEN 1 AND 5),
  CONSTRAINT "incentive_f_submissions_text_check" CHECK (length("submitted_url") BETWEEN 1 AND 2000 AND length(btrim("submitted_by_name")) BETWEEN 1 AND 200
    AND ("screenshot_url" IS NULL OR length("screenshot_url") BETWEEN 1 AND 2000) AND ("claimed_text" IS NULL OR length("claimed_text") <= 5000))
);
CREATE INDEX IF NOT EXISTS "incentive_f_submissions_review_idx" ON "incentive_f_submissions" ("review_id");
CREATE INDEX IF NOT EXISTS "incentive_f_submissions_url_idx" ON "incentive_f_submissions" ("url_key");
CREATE INDEX IF NOT EXISTS "incentive_f_submissions_by_idx" ON "incentive_f_submissions" ("submitted_by_id", "created_at");
DROP TRIGGER IF EXISTS "incentive_f_submissions_no_change" ON "incentive_f_submissions";
CREATE TRIGGER "incentive_f_submissions_no_change" BEFORE UPDATE OR DELETE ON "incentive_f_submissions" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('testimonial_id', 'submitted_by_id');

-- ── decisions: verification, attribution, invalidation ───────────────────────
CREATE TABLE IF NOT EXISTS "incentive_f_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "review_id" uuid NOT NULL REFERENCES "incentive_f_reviews"("id") ON DELETE RESTRICT,
  "submission_id" uuid REFERENCES "incentive_f_submissions"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL,
  "request_id" uuid REFERENCES "incentive_f_decisions"("id") ON DELETE RESTRICT,
  "rating" smallint,
  "published_on" date,
  "review_month" date,
  "review_text" text,
  "google_review_id" text,
  "named_employee_ids" uuid[] NOT NULL DEFAULT '{}',
  "named_employee_names" text[] NOT NULL DEFAULT '{}',
  "customer_master_id" uuid REFERENCES "customer_masters"("id") ON DELETE SET NULL,
  "credited_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "credited_employee_name" text,
  "basis" text,
  "reason" text NOT NULL,
  "evidence_url" text,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz,
  "retired_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "retired_reason" text,
  CONSTRAINT "incentive_f_decisions_kind_check" CHECK ("kind" IN ('verify', 'reject', 'needs-review', 'link', 'attribute', 'invalidate-request', 'invalidate-approve', 'invalidate-refuse')),
  CONSTRAINT "incentive_f_decisions_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000 AND length(btrim("created_by_name")) BETWEEN 1 AND 200),
  CONSTRAINT "incentive_f_decisions_verify_check" CHECK ("kind" <> 'verify' OR ("rating" BETWEEN 1 AND 5 AND "published_on" IS NOT NULL AND "review_month" = date_trunc('month', "published_on")::date)),
  CONSTRAINT "incentive_f_decisions_link_check" CHECK ("kind" <> 'link' OR "submission_id" IS NOT NULL),
  CONSTRAINT "incentive_f_decisions_attribute_check" CHECK ("kind" <> 'attribute' OR (length(btrim(coalesce("credited_employee_name", ''))) BETWEEN 1 AND 200 AND "basis" IN ('named', 'assigned', 'claim'))),
  CONSTRAINT "incentive_f_decisions_evidence_check" CHECK ("kind" <> 'invalidate-request' OR length(btrim(coalesce("evidence_url", ''))) BETWEEN 1 AND 2000),
  CONSTRAINT "incentive_f_decisions_request_check" CHECK (("kind" IN ('invalidate-approve', 'invalidate-refuse')) = ("request_id" IS NOT NULL)),
  CONSTRAINT "incentive_f_decisions_named_check" CHECK (cardinality("named_employee_ids") = cardinality("named_employee_names")),
  CONSTRAINT "incentive_f_decisions_text_check" CHECK ("review_text" IS NULL OR length("review_text") <= 10000),
  CONSTRAINT "incentive_f_decisions_retired_check" CHECK (("retired_at" IS NULL AND "retired_reason" IS NULL) OR ("retired_at" IS NOT NULL AND length(btrim(coalesce("retired_reason", ''))) BETWEEN 1 AND 1000))
);
-- One ACTIVE verdict, one active attribution and one active link per review / submission; a verified Google review ID
-- once; an invalidation request decided once; a review invalidated once.
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_verdict_uq" ON "incentive_f_decisions" ("review_id") WHERE "kind" IN ('verify', 'reject', 'needs-review') AND "retired_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_attribution_uq" ON "incentive_f_decisions" ("review_id") WHERE "kind" = 'attribute' AND "retired_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_review_id_uq" ON "incentive_f_decisions" ("google_review_id") WHERE "kind" = 'verify' AND "retired_at" IS NULL AND "google_review_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_link_uq" ON "incentive_f_decisions" ("submission_id") WHERE "kind" = 'link' AND "retired_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_request_uq" ON "incentive_f_decisions" ("request_id") WHERE "request_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_invalidated_uq" ON "incentive_f_decisions" ("review_id") WHERE "kind" = 'invalidate-approve';
CREATE INDEX IF NOT EXISTS "incentive_f_decisions_review_idx" ON "incentive_f_decisions" ("review_id", "created_at");

CREATE OR REPLACE FUNCTION "incentive_f_decisions_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v record;
  r record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_f_decisions'), hashtext(NEW."review_id"::text));
  IF NEW."retired_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A Category F decision is recorded active and retired later' USING ERRCODE = 'check_violation';
  END IF;
  -- Nobody decides a review they submitted themselves.
  IF NEW."kind" IN ('verify', 'reject', 'needs-review', 'link', 'attribute') AND NEW."created_by_id" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "incentive_f_submissions" s
    WHERE (s."review_id" = NEW."review_id" OR s."id" = NEW."submission_id") AND s."submitted_by_id" = NEW."created_by_id"
  ) THEN
    RAISE EXCEPTION 'Whoever submitted a Google review never verifies, links or attributes it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'link' AND EXISTS (SELECT 1 FROM "incentive_f_submissions" s WHERE s."id" = NEW."submission_id" AND s."review_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Only an unresolved submission is linked to a review' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" IN ('verify', 'attribute') AND EXISTS (SELECT 1 FROM "incentive_f_decisions" d WHERE d."review_id" = NEW."review_id" AND d."kind" = 'invalidate-approve') THEN
    RAISE EXCEPTION 'An invalidated review is never verified or attributed again' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v FROM "incentive_f_decisions" d WHERE d."review_id" = NEW."review_id" AND d."kind" = 'verify' AND d."retired_at" IS NULL;
  IF NEW."kind" = 'attribute' THEN
    IF v IS NULL THEN
      RAISE EXCEPTION 'A review is attributed only once it is verified' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."credited_employee_id" IS NOT NULL AND NEW."credited_employee_id" = NEW."created_by_id" THEN
      RAISE EXCEPTION 'Nobody attributes a review to themselves' USING ERRCODE = 'check_violation';
    END IF;
    -- The priority: a named salesperson first (when several are named, an authorised choice among them); otherwise the
    -- customer's assigned salesperson or an admin-confirmed claim.
    IF cardinality(v."named_employee_ids") > 0 AND (NEW."basis" <> 'named' OR NOT (NEW."credited_employee_id" = ANY (v."named_employee_ids"))) THEN
      RAISE EXCEPTION 'The review names a salesperson: it is attributed to one of those named' USING ERRCODE = 'check_violation';
    END IF;
    IF cardinality(v."named_employee_ids") = 0 AND NEW."basis" = 'named' THEN
      RAISE EXCEPTION 'The review names nobody: it is attributed to the assigned salesperson or by a confirmed claim' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."kind" = 'invalidate-request' THEN
    IF v IS NULL THEN
      RAISE EXCEPTION 'Only a verified review is invalidated' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "incentive_f_decisions" d WHERE d."review_id" = NEW."review_id" AND d."kind" = 'invalidate-approve') THEN
      RAISE EXCEPTION 'The review is already invalidated' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "incentive_f_decisions" q WHERE q."review_id" = NEW."review_id" AND q."kind" = 'invalidate-request'
               AND NOT EXISTS (SELECT 1 FROM "incentive_f_decisions" a WHERE a."request_id" = q."id")) THEN
      RAISE EXCEPTION 'An invalidation of this review already awaits its second approval' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."kind" IN ('invalidate-approve', 'invalidate-refuse') THEN
    SELECT * INTO r FROM "incentive_f_decisions" q WHERE q."id" = NEW."request_id";
    IF r IS NULL OR r."kind" <> 'invalidate-request' OR r."review_id" <> NEW."review_id" THEN
      RAISE EXCEPTION 'An invalidation is approved or refused against its own request' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."created_by_id" IS NULL OR NEW."created_by_id" IS NOT DISTINCT FROM r."created_by_id" THEN
      RAISE EXCEPTION 'A second person approves or refuses an invalidation, never whoever requested it' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_f_decisions_insert" ON "incentive_f_decisions";
CREATE TRIGGER "incentive_f_decisions_insert" BEFORE INSERT ON "incentive_f_decisions" FOR EACH ROW EXECUTE FUNCTION "incentive_f_decisions_check"();
-- Never edited or deleted: a verdict, link or attribution is RETIRED (with who and why) and a new one recorded; an
-- invalidation decision is permanent. A deleted employee's or customer's link may become null.
CREATE OR REPLACE FUNCTION "incentive_f_decisions_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c text;
  o jsonb;
  n jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A Category F decision is never deleted; retire it instead' USING ERRCODE = 'restrict_violation';
  END IF;
  o := to_jsonb(OLD);
  n := to_jsonb(NEW);
  FOREACH c IN ARRAY ARRAY['created_by_id', 'retired_by_id', 'credited_employee_id', 'customer_master_id'] LOOP
    IF n -> c = 'null'::jsonb THEN
      o := o - c;
      n := n - c;
    END IF;
  END LOOP;
  IF o = n THEN
    RETURN NEW;
  END IF;
  IF OLD."retired_at" IS NULL AND NEW."retired_at" IS NOT NULL AND OLD."kind" IN ('verify', 'reject', 'needs-review', 'link', 'attribute')
     AND (o - 'retired_at' - 'retired_reason' - 'retired_by_id') = (n - 'retired_at' - 'retired_reason' - 'retired_by_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A Category F decision never changes; retire it and record a new one' USING ERRCODE = 'restrict_violation';
END
$$;
DROP TRIGGER IF EXISTS "incentive_f_decisions_guard" ON "incentive_f_decisions";
CREATE TRIGGER "incentive_f_decisions_guard" BEFORE UPDATE OR DELETE ON "incentive_f_decisions" FOR EACH ROW EXECUTE FUNCTION "incentive_f_decisions_guard"();

-- ── a two-person recovery write-off ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_f_writeoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "request_id" uuid REFERENCES "incentive_f_writeoffs"("id") ON DELETE RESTRICT,
  "adjustment_id" uuid NOT NULL REFERENCES "incentive_calc_adjustments"("id") ON DELETE RESTRICT,
  "result_adjustment_id" uuid REFERENCES "incentive_calc_adjustments"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "employee_name" text NOT NULL,
  "amount_paise" bigint NOT NULL,
  "reason" text NOT NULL,
  "evidence_url" text,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_f_writeoffs_kind_check" CHECK ("kind" IN ('request', 'approve', 'refuse') AND (("kind" = 'request') = ("request_id" IS NULL)) AND (("kind" = 'approve') = ("result_adjustment_id" IS NOT NULL))),
  CONSTRAINT "incentive_f_writeoffs_amount_check" CHECK ("amount_paise" > 0),
  CONSTRAINT "incentive_f_writeoffs_text_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000 AND length(btrim("created_by_name")) BETWEEN 1 AND 200 AND length(btrim("employee_name")) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_writeoffs_decided_uq" ON "incentive_f_writeoffs" ("request_id") WHERE "request_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_writeoffs_once_uq" ON "incentive_f_writeoffs" ("adjustment_id") WHERE "kind" = 'approve';
CREATE INDEX IF NOT EXISTS "incentive_f_writeoffs_adjustment_idx" ON "incentive_f_writeoffs" ("adjustment_id");
CREATE OR REPLACE FUNCTION "incentive_f_writeoffs_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a record;
  r record;
  w record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_f_writeoffs'), hashtext(NEW."adjustment_id"::text));
  SELECT * INTO a FROM "incentive_calc_adjustments" x WHERE x."id" = NEW."adjustment_id";
  IF a IS NULL OR a."category_code" <> 'F' OR a."amount_paise" >= 0 OR a."to_month" IS NULL OR a."kind" NOT IN ('recalc-difference', 'negative-carry') THEN
    RAISE EXCEPTION 'Only a Category F recovery (a negative amount carried into a month) is written off' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."amount_paise" > -a."amount_paise" THEN
    RAISE EXCEPTION 'A write-off never exceeds the recovery: % paise asked, % to recover', NEW."amount_paise", -a."amount_paise" USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "incentive_f_writeoffs" x WHERE x."adjustment_id" = NEW."adjustment_id" AND x."kind" = 'approve') THEN
    RAISE EXCEPTION 'This recovery is already written off' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'request' THEN
    IF EXISTS (SELECT 1 FROM "incentive_f_writeoffs" q WHERE q."adjustment_id" = NEW."adjustment_id" AND q."kind" = 'request'
               AND NOT EXISTS (SELECT 1 FROM "incentive_f_writeoffs" d WHERE d."request_id" = q."id")) THEN
      RAISE EXCEPTION 'A write-off of this recovery already awaits its second approval' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO r FROM "incentive_f_writeoffs" q WHERE q."id" = NEW."request_id";
    IF r IS NULL OR r."kind" <> 'request' OR r."adjustment_id" <> NEW."adjustment_id" OR r."amount_paise" <> NEW."amount_paise" THEN
      RAISE EXCEPTION 'A write-off is approved or refused against its own request, for its amount' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."created_by_id" IS NULL OR NEW."created_by_id" IS NOT DISTINCT FROM r."created_by_id" THEN
      RAISE EXCEPTION 'A second person approves or refuses a write-off, never whoever requested it' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."kind" = 'approve' THEN
      SELECT * INTO w FROM "incentive_calc_adjustments" x WHERE x."id" = NEW."result_adjustment_id";
      IF w IS NULL OR w."kind" <> 'recovery-write-off' OR w."program_id" <> a."program_id" OR w."employee_id" IS DISTINCT FROM a."employee_id"
         OR w."to_month" <> a."to_month" OR w."amount_paise" <> NEW."amount_paise" THEN
        RAISE EXCEPTION 'An approved write-off records exactly its amount, into the month the recovery is taken from' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_f_writeoffs_insert" ON "incentive_f_writeoffs";
CREATE TRIGGER "incentive_f_writeoffs_insert" BEFORE INSERT ON "incentive_f_writeoffs" FOR EACH ROW EXECUTE FUNCTION "incentive_f_writeoffs_check"();
DROP TRIGGER IF EXISTS "incentive_f_writeoffs_no_change" ON "incentive_f_writeoffs";
CREATE TRIGGER "incentive_f_writeoffs_no_change" BEFORE UPDATE OR DELETE ON "incentive_f_writeoffs" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id', 'created_by_id');

-- ── separation of duties ──────────────────────────────────────────────────────
-- Whoever recorded or retired a decision on any review of a Category F month's calculation never approves or rejects it.
CREATE OR REPLACE FUNCTION "incentive_calc_f_approvals_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."actor_id" IS NOT NULL AND (SELECT "category_code" FROM "incentive_calc_periods" WHERE "id" = NEW."period_id") = 'F' AND EXISTS (
    SELECT 1 FROM "incentive_calc_runs" run
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(run."inputs"->'fReviews', '[]'::jsonb)) rv
    JOIN "incentive_f_decisions" d ON d."review_id"::text = rv->>'reviewId'
    WHERE run."id" = NEW."run_id" AND (d."created_by_id" = NEW."actor_id" OR d."retired_by_id" = NEW."actor_id")
  ) THEN
    RAISE EXCEPTION 'Whoever decided a Category F review of a month never approves or rejects that month' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_f_approvals_insert" ON "incentive_calc_approvals";
CREATE TRIGGER "incentive_calc_f_approvals_insert" BEFORE INSERT ON "incentive_calc_approvals" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_f_approvals_check"();

COMMENT ON TABLE "incentive_f_reviews" IS 'Category F: one row per unique Google review (review ID and / or normalised URL, each unique). Append-only.';
COMMENT ON TABLE "incentive_f_submissions" IS 'Category F: each salesperson''s claim of a Google review (URL, screenshot, claimed date, rating, text). Append-only.';
COMMENT ON TABLE "incentive_f_decisions" IS 'Category F: verification, attribution and two-person invalidation decisions, each with its reason. Retire-only; invalidation permanent.';
COMMENT ON TABLE "incentive_f_writeoffs" IS 'Category F: two-person recovery write-offs (request, approve or refuse), each with its reason. Append-only.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_f_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_f_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_f_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_f_writeoffs" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_f_reviews FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_f_submissions FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_f_decisions FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_f_writeoffs FROM %I', r);
    END IF;
  END LOOP;
END
$$;
