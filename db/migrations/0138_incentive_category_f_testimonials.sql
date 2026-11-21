-- 0138 Incentive calculation — Category F: the four testimonial rewards of the original scheme on 0137's registry —
-- F.1 Google review, F.2 testimonial on email, F.3 testimonial on the customer's letterhead, and F.4 appreciation (the
-- applicable reward multiplied when the testimonial appreciates the credited salesperson or any team member by name).
--
-- Depends on 0137. PREPARED FOR REVIEW: never apply through pnpm db:migrate; apply only after a separate approval, through
-- a hash-pinned runner. Its rollback (db/rollback/0138_incentive_category_f_testimonials.rollback.sql) restores 0137
-- exactly and refuses while any data only 0138 allows exists.
--
-- WHAT.
--   incentive_f_submissions  + claimed_kind (google_review | email | letterhead; earlier rows are Google reviews);
--                            claimed_rating becomes optional: required (1–5) for a Google review, absent otherwise.
--   incentive_f_decisions    + testimonial_kind — the type a verification establishes (earlier rows: Google reviews);
--                            + appreciated_employee_ids / _names — F.4: the people a testimonial appreciates
--                              CATEGORICALLY BY NAME (the credited salesperson or any team member; vague praise: none);
--                            + evidence_key — an email / letterhead testimonial's canonical identity, recorded by the
--                              verifier: UNIQUE among active verifications, across employees and testimonial types;
--                            + confirmed_from_customer / confirmed_type / confirmed_genuine — the verifier's findings:
--                              genuinely from the customer; really an email (F.2) / really the customer's letterhead (F.3);
--                              genuine. All three are required for an email or letterhead verification;
--                            the verification check (NULL-safe: a missing type or rating is refused, never let through):
--                              a Google review keeps its 1–5 rating (no evidence key); an email or
--                              letterhead testimonial has no rating, an evidence key and all three findings;
--                            the insert check (0137's, verbatim) + one rule: an email / letterhead verification names its
--                              customer (a CHECK can't: a deleted customer's link becomes null).
--   No setting key changes: F.2, F.3 and F.4 use f.emailAmount, f.letterheadAmount and f.namedMultiple (already allowed).
--
-- No existing row changes. RLS and REST revocation are unchanged (no new table). Safe to re-run.

-- ── submissions: the claimed testimonial type ────────────────────────────────
ALTER TABLE "incentive_f_submissions" ADD COLUMN IF NOT EXISTS "claimed_kind" text NOT NULL DEFAULT 'google_review';
ALTER TABLE "incentive_f_submissions" ALTER COLUMN "claimed_rating" DROP NOT NULL;
ALTER TABLE "incentive_f_submissions" DROP CONSTRAINT IF EXISTS "incentive_f_submissions_rating_check";
ALTER TABLE "incentive_f_submissions" ADD CONSTRAINT "incentive_f_submissions_rating_check" CHECK ("claimed_kind" IN ('google_review', 'email', 'letterhead') AND (("claimed_kind" = 'google_review') = ("claimed_rating" IS NOT NULL)) AND ("claimed_rating" IS NULL OR "claimed_rating" BETWEEN 1 AND 5)) NOT VALID;
ALTER TABLE "incentive_f_submissions" VALIDATE CONSTRAINT "incentive_f_submissions_rating_check";

-- ── decisions: the verified type, F.4 appreciation, the evidence identity and findings ──────────────────────────
-- (A default on ADD COLUMN fills earlier rows — all 0137 Google reviews — without an UPDATE; then it is dropped.)
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "testimonial_kind" text DEFAULT 'google_review';
ALTER TABLE "incentive_f_decisions" ALTER COLUMN "testimonial_kind" DROP DEFAULT;
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "appreciated_employee_ids" uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "appreciated_employee_names" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "evidence_key" text;
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "confirmed_from_customer" boolean NOT NULL DEFAULT false;
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "confirmed_type" boolean NOT NULL DEFAULT false;
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "confirmed_genuine" boolean NOT NULL DEFAULT false;
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_testimonial_kind_check";
ALTER TABLE "incentive_f_decisions" ADD CONSTRAINT "incentive_f_decisions_testimonial_kind_check" CHECK ("testimonial_kind" IS NULL OR "testimonial_kind" IN ('google_review', 'email', 'letterhead')) NOT VALID;
ALTER TABLE "incentive_f_decisions" VALIDATE CONSTRAINT "incentive_f_decisions_testimonial_kind_check";
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_appreciated_check";
ALTER TABLE "incentive_f_decisions" ADD CONSTRAINT "incentive_f_decisions_appreciated_check" CHECK (cardinality("appreciated_employee_ids") = cardinality("appreciated_employee_names")) NOT VALID;
ALTER TABLE "incentive_f_decisions" VALIDATE CONSTRAINT "incentive_f_decisions_appreciated_check";
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_evidence_key_check";
ALTER TABLE "incentive_f_decisions" ADD CONSTRAINT "incentive_f_decisions_evidence_key_check" CHECK ("evidence_key" IS NULL OR length("evidence_key") BETWEEN 3 AND 500) NOT VALID;
ALTER TABLE "incentive_f_decisions" VALIDATE CONSTRAINT "incentive_f_decisions_evidence_key_check";
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_verify_check";
ALTER TABLE "incentive_f_decisions" ADD CONSTRAINT "incentive_f_decisions_verify_check" CHECK ("kind" <> 'verify' OR coalesce(("published_on" IS NOT NULL AND "review_month" = date_trunc('month', "published_on")::date AND (
    ("testimonial_kind" = 'google_review' AND "rating" BETWEEN 1 AND 5 AND "evidence_key" IS NULL)
    OR ("testimonial_kind" IN ('email', 'letterhead') AND "rating" IS NULL AND "evidence_key" IS NOT NULL AND "confirmed_from_customer" AND "confirmed_type" AND "confirmed_genuine"))), false)) NOT VALID;
ALTER TABLE "incentive_f_decisions" VALIDATE CONSTRAINT "incentive_f_decisions_verify_check";
-- One testimonial earns once: its evidence identity is verified once (across employees and testimonial types).
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_evidence_key_uq" ON "incentive_f_decisions" ("evidence_key") WHERE "kind" = 'verify' AND "retired_at" IS NULL AND "evidence_key" IS NOT NULL;

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
  -- 0138: an email or letterhead testimonial is verified against the customer it comes from (genuinely the customer's).
  IF NEW."kind" = 'verify' AND NEW."testimonial_kind" IN ('email', 'letterhead') AND NEW."customer_master_id" IS NULL THEN
    RAISE EXCEPTION 'An email or letterhead testimonial is verified against its customer (Customer Master)' USING ERRCODE = 'check_violation';
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
