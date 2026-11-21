-- ROLLBACK of 0138 (Category F: email and letterhead testimonials, F.4 appreciation). NEVER put this file in
-- db/migrations: nothing applies it automatically. Run it only after a separate approval, in ONE transaction.
--
-- It refuses (raises, so the transaction changes nothing) while ANY data that only 0138 allows exists: an email or
-- letterhead submission (or one without a rating), a decision recording an email / letterhead type, an appreciation,
-- an evidence key or a verifier finding. With none, it restores 0137 exactly: 0137's insert-check function and
-- verification / rating checks (copied verbatim from 0137), claimed_rating NOT NULL, and drops 0138's columns, checks
-- and index.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "incentive_f_submissions" WHERE "claimed_kind" <> 'google_review' OR "claimed_rating" IS NULL)
     OR EXISTS (SELECT 1 FROM "incentive_f_decisions" WHERE "testimonial_kind" IN ('email', 'letterhead') OR cardinality("appreciated_employee_ids") > 0
                OR "evidence_key" IS NOT NULL OR "confirmed_from_customer" OR "confirmed_type" OR "confirmed_genuine")
  THEN
    RAISE EXCEPTION '0138 rollback refused: data only 0138 allows exists (email or letterhead testimonials, appreciations, evidence keys or verifier findings). Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

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

DROP INDEX IF EXISTS "incentive_f_decisions_evidence_key_uq";
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_verify_check";
ALTER TABLE "incentive_f_decisions" ADD CONSTRAINT "incentive_f_decisions_verify_check" CHECK ("kind" <> 'verify' OR ("rating" BETWEEN 1 AND 5 AND "published_on" IS NOT NULL AND "review_month" = date_trunc('month', "published_on")::date));
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_evidence_key_check";
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_appreciated_check";
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_testimonial_kind_check";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "confirmed_genuine";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "confirmed_type";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "confirmed_from_customer";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "evidence_key";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "appreciated_employee_names";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "appreciated_employee_ids";
ALTER TABLE "incentive_f_decisions" DROP COLUMN IF EXISTS "testimonial_kind";

ALTER TABLE "incentive_f_submissions" DROP CONSTRAINT IF EXISTS "incentive_f_submissions_rating_check";
ALTER TABLE "incentive_f_submissions" ADD CONSTRAINT "incentive_f_submissions_rating_check" CHECK ("claimed_rating" BETWEEN 1 AND 5);
ALTER TABLE "incentive_f_submissions" ALTER COLUMN "claimed_rating" SET NOT NULL;
ALTER TABLE "incentive_f_submissions" DROP COLUMN IF EXISTS "claimed_kind";
