-- 0142 Incentive calculation — Category A: held items acknowledged, two-person negative balances, database safeguards.
--
-- NOT APPLIED. Prepared only; it needs its own approval. Depends on 0131–0133 (Category A), which it extends; none of
-- them is changed. Never apply through pnpm db:migrate; apply this one file only through its hash-pinned runner
-- (scripts/incentive-0142) after a separate approval. Its rollback is db/rollback/0142_incentive_category_a_safeguards.rollback.sql.
-- ORDER: the 0138–0141 runners each refuse unless they are the next file in the ledger, so decide (apply or discard)
-- 0138–0141 before this one.
--
-- WHY. Category A's calculation (engine category-a/2) holds what it can't work out — a receipt held for review, an
-- order credited to nobody, a credit note with no invoice link or no amount, a pre-closure that can't be valued,
-- links not fully followed — and the service keeps the month from being submitted, approved or paid while anything is
-- held. A hold is resolved at its source (and the month recalculated), or acknowledged here. A negative balance the
-- configuration writes off or recovers from salary is a decision about money, so a second person approves it. And the
-- separation of duties the service enforces for Category A is enforced by the database too.
--
-- WHAT.
--   incentive_calc_a_reviews          an acknowledgment of a held item (document + kind of hold), with its reason.
--                                     It never changes a calculation. Retire-only (0133's input guard); one ACTIVE
--                                     acknowledgment per document and kind; recorded active.
--   incentive_calc_negative_decisions request / approve / refuse of a write-off or salary recovery of a negative balance
--                                     at lock: the period (Category A, open), the run, the salesperson, the outcome, the
--                                     amount. One open request per run and salesperson; one decision per request, by a
--                                     SECOND person, for exactly the request. Append-only.
--   incentive_calc_adjustments (0132): from now on a Category A 'write-off' or 'salary-recovery' entry is accepted only
--     with an approved decision for exactly its period, run, salesperson, outcome and amount (checked at commit).
--     Entries recorded before 0142 are left exactly as they are; no column is added.
--   incentive_calc_approvals (0133), Category A only — whoever approves or rejects a month is never:
--     the person who calculated its adopted run; the person who locked it; a salesperson it pays (payable above ₹0);
--     a person who recorded or retired an input it uses (order salespeople, representative periods of its customers,
--     receipt events on its documents); a person who recorded or retired an acknowledgment of a hold it lists.
--   incentive_calc_payouts (0133), Category A only — a payout is dated on or after its release date and never in the
--     future (India); whoever records it approved no step of the submission it pays; and, at commit, its total is
--     exactly the sum of its lines, each line's payable is the adopted run's for that salesperson, its adjustments the
--     sum carried into the month, and every salesperson of the run and of those adjustments has exactly one line.
--
-- No existing row is changed. RLS on, no policies, REST roles revoked. Safe to re-run.

-- ── acknowledgments of held items ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_a_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "tally_documents"("id") ON DELETE RESTRICT,
  "hold_code" text NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz,
  "retired_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "retired_reason" text,
  CONSTRAINT "incentive_calc_a_reviews_code_check" CHECK ("hold_code" IN ('receipt', 'unassigned', 'credit-note-unlinked', 'credit-note-no-amount', 'preclosure-incomplete', 'reference-chain')),
  CONSTRAINT "incentive_calc_a_reviews_decision_check" CHECK ("decision" IN ('acknowledged')),
  CONSTRAINT "incentive_calc_a_reviews_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
  CONSTRAINT "incentive_calc_a_reviews_name_check" CHECK (length(btrim("created_by_name")) BETWEEN 1 AND 200),
  CONSTRAINT "incentive_calc_a_reviews_retired_check" CHECK (("retired_at" IS NULL AND "retired_reason" IS NULL) OR ("retired_at" IS NOT NULL AND length(btrim(coalesce("retired_reason", ''))) BETWEEN 1 AND 1000))
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_a_reviews_active_uq" ON "incentive_calc_a_reviews" ("document_id", "hold_code") WHERE "retired_at" IS NULL;
CREATE INDEX IF NOT EXISTS "incentive_calc_a_reviews_document_idx" ON "incentive_calc_a_reviews" ("document_id", "created_at");

CREATE OR REPLACE FUNCTION "incentive_calc_a_reviews_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_a_reviews'), hashtext(NEW."document_id"::text || '|' || NEW."hold_code"));
  IF NEW."retired_at" IS NOT NULL THEN
    RAISE EXCEPTION 'An acknowledgment is recorded active and retired later' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_a_reviews_insert" ON "incentive_calc_a_reviews";
CREATE TRIGGER "incentive_calc_a_reviews_insert" BEFORE INSERT ON "incentive_calc_a_reviews" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_a_reviews_check"();
DROP TRIGGER IF EXISTS "incentive_calc_a_reviews_guard" ON "incentive_calc_a_reviews";
CREATE TRIGGER "incentive_calc_a_reviews_guard" BEFORE UPDATE OR DELETE ON "incentive_calc_a_reviews" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_input_guard"();

-- ── two-person negative balances ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_negative_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "request_id" uuid REFERENCES "incentive_calc_negative_decisions"("id") ON DELETE RESTRICT,
  "period_id" uuid NOT NULL REFERENCES "incentive_calc_periods"("id") ON DELETE RESTRICT,
  "run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "employee_name" text NOT NULL,
  "outcome" text NOT NULL,
  "amount_paise" bigint NOT NULL,
  "reason" text NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_negative_decisions_kind_check" CHECK ("kind" IN ('request', 'approve', 'refuse') AND (("kind" = 'request') = ("request_id" IS NULL))),
  CONSTRAINT "incentive_calc_negative_decisions_outcome_check" CHECK ("outcome" IN ('write-off', 'salary-recovery')),
  CONSTRAINT "incentive_calc_negative_decisions_amount_check" CHECK ("amount_paise" > 0),
  CONSTRAINT "incentive_calc_negative_decisions_text_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000 AND length(btrim("created_by_name")) BETWEEN 1 AND 200 AND length(btrim("employee_name")) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_negative_decisions_decided_uq" ON "incentive_calc_negative_decisions" ("request_id") WHERE "request_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "incentive_calc_negative_decisions_period_idx" ON "incentive_calc_negative_decisions" ("period_id", "created_at");

CREATE OR REPLACE FUNCTION "incentive_calc_negative_decisions_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
  r record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_negative_decisions'), hashtext(NEW."period_id"::text));
  SELECT * INTO p FROM "incentive_calc_periods" WHERE "id" = NEW."period_id";
  IF p IS NULL OR p."category_code" <> 'A' OR p."status" <> 'open' OR p."current_run_id" IS DISTINCT FROM NEW."run_id" THEN
    RAISE EXCEPTION 'A negative-balance decision is of an open Category A month''s adopted calculation' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."created_by_id" IS NULL THEN
    RAISE EXCEPTION 'A negative-balance decision names who made it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'request' THEN
    IF EXISTS (SELECT 1 FROM "incentive_calc_negative_decisions" q WHERE q."kind" = 'request' AND q."run_id" = NEW."run_id" AND q."employee_id" IS NOT DISTINCT FROM NEW."employee_id"
               AND NOT EXISTS (SELECT 1 FROM "incentive_calc_negative_decisions" d WHERE d."request_id" = q."id")) THEN
      RAISE EXCEPTION 'A decision on this negative balance already awaits its second person' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO r FROM "incentive_calc_negative_decisions" q WHERE q."id" = NEW."request_id";
    IF r IS NULL OR r."kind" <> 'request' OR r."period_id" <> NEW."period_id" OR r."run_id" <> NEW."run_id" OR r."employee_id" IS DISTINCT FROM NEW."employee_id" OR r."outcome" <> NEW."outcome" OR r."amount_paise" <> NEW."amount_paise" THEN
      RAISE EXCEPTION 'A negative-balance decision is approved or refused against its own request, exactly' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."created_by_id" IS NOT DISTINCT FROM r."created_by_id" THEN
      RAISE EXCEPTION 'A second person approves or refuses a negative-balance decision, never whoever requested it' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_negative_decisions_insert" ON "incentive_calc_negative_decisions";
CREATE TRIGGER "incentive_calc_negative_decisions_insert" BEFORE INSERT ON "incentive_calc_negative_decisions" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_negative_decisions_check"();
DROP TRIGGER IF EXISTS "incentive_calc_negative_decisions_no_change" ON "incentive_calc_negative_decisions";
CREATE TRIGGER "incentive_calc_negative_decisions_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_negative_decisions" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id', 'created_by_id');

-- A Category A write-off or salary recovery exists only with a second person's approval of exactly it (at commit, so
-- the lock writes the entry in the same transaction that checked the approval).
CREATE OR REPLACE FUNCTION "incentive_calc_a_negative_approved"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."category_code" = 'A' AND NEW."kind" IN ('write-off', 'salary-recovery') AND NOT EXISTS (
    SELECT 1 FROM "incentive_calc_negative_decisions" a JOIN "incentive_calc_periods" p ON p."id" = a."period_id"
    WHERE a."kind" = 'approve' AND a."run_id" = NEW."source_run_id" AND a."employee_id" IS NOT DISTINCT FROM NEW."employee_id"
      AND a."outcome" = NEW."kind" AND a."amount_paise" = NEW."amount_paise" AND p."program_id" = NEW."program_id" AND p."month" = NEW."from_month"
  ) THEN
    RAISE EXCEPTION 'A Category A negative balance is written off or recovered from salary only with a second person''s approval' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_a_negative_approved" ON "incentive_calc_adjustments";
CREATE CONSTRAINT TRIGGER "incentive_calc_a_negative_approved" AFTER INSERT ON "incentive_calc_adjustments" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "incentive_calc_a_negative_approved"();

-- ── separation of duties at approval (Category A) ─────────────────────────────
CREATE OR REPLACE FUNCTION "incentive_calc_a_approvals_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
  run record;
BEGIN
  SELECT * INTO p FROM "incentive_calc_periods" WHERE "id" = NEW."period_id";
  IF p IS NULL OR p."category_code" <> 'A' OR NEW."actor_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO run FROM "incentive_calc_runs" WHERE "id" = NEW."run_id";
  IF run."computed_by_id" IS NOT DISTINCT FROM NEW."actor_id" THEN
    RAISE EXCEPTION 'Whoever calculated a Category A month never approves or rejects it' USING ERRCODE = 'check_violation';
  END IF;
  IF p."locked_by_id" IS NOT DISTINCT FROM NEW."actor_id" THEN
    RAISE EXCEPTION 'Whoever locked a Category A month never approves or rejects it' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "incentive_calc_results" r WHERE r."run_id" = NEW."run_id" AND r."employee_id" = NEW."actor_id" AND r."payable_paise" > 0) THEN
    RAISE EXCEPTION 'Nobody approves or rejects a Category A month that pays them' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    WITH docs AS (SELECT d->>'id' AS id FROM jsonb_array_elements(coalesce(run."inputs"->'orders', '[]'::jsonb) || coalesce(run."inputs"->'invoices', '[]'::jsonb) || coalesce(run."inputs"->'creditNotes', '[]'::jsonb) || coalesce(run."inputs"->'receipts', '[]'::jsonb)) d),
    custs AS (SELECT c->>'id' AS id FROM jsonb_array_elements(coalesce(run."inputs"->'customers', '[]'::jsonb)) c)
    SELECT 1 WHERE
      EXISTS (SELECT 1 FROM "incentive_calc_attributions" a WHERE a."document_id"::text IN (SELECT id FROM docs) AND (a."created_by_id" = NEW."actor_id" OR a."retired_by_id" = NEW."actor_id"))
      OR EXISTS (SELECT 1 FROM "incentive_calc_rep_history" h WHERE h."customer_master_id"::text IN (SELECT id FROM custs) AND (h."created_by_id" = NEW."actor_id" OR h."retired_by_id" = NEW."actor_id"))
      OR EXISTS (SELECT 1 FROM "incentive_calc_receipt_events" e WHERE e."document_id"::text IN (SELECT id FROM docs) AND (e."created_by_id" = NEW."actor_id" OR e."retired_by_id" = NEW."actor_id"))
  ) THEN
    RAISE EXCEPTION 'Whoever recorded or retired an input a Category A month uses never approves or rejects it' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(run."result"->'held', '[]'::jsonb)) h
    JOIN "incentive_calc_a_reviews" v ON v."document_id"::text = h->>'documentId' AND v."hold_code" = h->>'code'
    WHERE v."created_by_id" = NEW."actor_id" OR v."retired_by_id" = NEW."actor_id"
  ) THEN
    RAISE EXCEPTION 'Whoever acknowledged a held item of a Category A month never approves or rejects it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_a_approvals_insert" ON "incentive_calc_approvals";
CREATE TRIGGER "incentive_calc_a_approvals_insert" BEFORE INSERT ON "incentive_calc_approvals" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_a_approvals_check"();

-- ── payouts (Category A) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "incentive_calc_a_payouts_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
BEGIN
  SELECT * INTO p FROM "incentive_calc_periods" WHERE "id" = NEW."period_id";
  IF p IS NULL OR p."category_code" <> 'A' THEN
    RETURN NEW;
  END IF;
  IF p."release_on" IS NULL OR NEW."release_on" <> p."release_on" OR NEW."paid_on" < p."release_on" THEN
    RAISE EXCEPTION 'A Category A payout is dated on or after the month''s release date' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."paid_on" > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'A Category A payout is recorded once it is made: it is never dated in the future' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."recorded_by_id" IS NULL OR EXISTS (SELECT 1 FROM "incentive_calc_approvals" a WHERE a."period_id" = p."id" AND a."submission_no" = p."submission_no" AND a."decision" = 'approve' AND a."actor_id" = NEW."recorded_by_id") THEN
    RAISE EXCEPTION 'Whoever approved a step of a Category A month never records its payout' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_a_payouts_insert" ON "incentive_calc_payouts";
CREATE TRIGGER "incentive_calc_a_payouts_insert" BEFORE INSERT ON "incentive_calc_payouts" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_a_payouts_check"();

-- At commit (the lines are written after the payout): the total, every line and the set of lines are exactly the
-- adopted run's payables with the adjustments carried into the month.
CREATE OR REPLACE FUNCTION "incentive_calc_a_payout_reconciled"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
  bad integer;
BEGIN
  SELECT * INTO p FROM "incentive_calc_periods" WHERE "id" = NEW."period_id";
  IF p IS NULL OR p."category_code" <> 'A' THEN
    RETURN NULL;
  END IF;
  IF NEW."total_paise" <> (SELECT coalesce(sum(l."amount_paise"), 0) FROM "incentive_calc_payout_lines" l WHERE l."payout_id" = NEW."id") THEN
    RAISE EXCEPTION 'A Category A payout''s total is exactly the sum of its lines' USING ERRCODE = 'check_violation';
  END IF;
  WITH expected AS (
    SELECT e."employee_id", coalesce(max(e."payable"), 0) AS payable, coalesce(sum(e."adj"), 0) AS adj FROM (
      SELECT r."employee_id", r."payable_paise" AS payable, 0::bigint AS adj FROM "incentive_calc_results" r WHERE r."run_id" = NEW."run_id" AND r."employee_id" IS NOT NULL
      UNION ALL
      SELECT a."employee_id", NULL, a."amount_paise" FROM "incentive_calc_adjustments" a WHERE a."program_id" = p."program_id" AND a."category_code" = 'A' AND a."to_month" = p."month" AND a."employee_id" IS NOT NULL
    ) e GROUP BY e."employee_id"
  ), lines AS (
    SELECT l."employee_id", l."payable_paise", l."adjustments_paise" FROM "incentive_calc_payout_lines" l WHERE l."payout_id" = NEW."id" AND l."employee_id" IS NOT NULL
  )
  SELECT count(*) INTO bad FROM expected x FULL JOIN lines l ON l."employee_id" = x."employee_id"
  WHERE x."employee_id" IS NULL OR l."employee_id" IS NULL OR l."payable_paise" <> x.payable OR l."adjustments_paise" <> x.adj;
  IF bad > 0 THEN
    RAISE EXCEPTION 'A Category A payout has exactly one line per salesperson, each the approved payable with the adjustments carried in' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_a_payout_reconciled" ON "incentive_calc_payouts";
CREATE CONSTRAINT TRIGGER "incentive_calc_a_payout_reconciled" AFTER INSERT ON "incentive_calc_payouts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "incentive_calc_a_payout_reconciled"();

-- ── descriptions ──────────────────────────────────────────────────────────────
COMMENT ON TABLE "incentive_calc_a_reviews" IS 'Category A: an authorised person''s acknowledgment, with its reason, of an item the calculation held. Never changes a calculation. Retire-only; one active acknowledgment per document and kind of hold.';
COMMENT ON TABLE "incentive_calc_negative_decisions" IS 'Category A: a two-person decision (request, then a second person''s approval or refusal) on writing off or recovering from salary a negative balance at lock. Append-only.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_a_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_negative_decisions" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incentive_calc_a_reviews', 'incentive_calc_negative_decisions'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
