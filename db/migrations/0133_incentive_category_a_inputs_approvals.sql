-- 0133 Incentive calculation — Category A completion: managed inputs, approval and payout records.
--
-- Depends on 0132 (incentive_calc_*), which it extends; 0132 itself is left byte-for-byte as reviewed. Never apply
-- through `pnpm db:migrate`; apply this one file through its hash-pinned apply script, after 0132.
--
-- WHAT.
--   Inputs (attributions, representative history, receipt events) are never edited or deleted: a correction RETIRES
--   the row (who, when, why) and records a new one, so every earlier calculation's inputs stay on record. A
--   calculation reads the rows in force on its "as of" day.
--     * attributions: one active row per order and salesperson; active shares of an order never exceed 100%.
--     * representative history: a customer's active periods never overlap (one representative at a time).
--     * receipt events: a new kind `hold` (held for review until the hold is retired); refunds and allocations by
--       hand never exceed the receipt; one active bounce / reversal / hold / sales-return marking per document;
--       each event names the right kind of Forms document.
--   incentive_calc_input_history   append-only record of every input recorded or retired, with before and after.
--   Periods gain `submitted`: open ↔ locked → submitted → approved → paid, and submitted → locked on rejection or
--   withdrawal. Approval needs the configured number of approvals of the CURRENT submission, by different people,
--   none of them the submitter. Paid needs a payout record. Paid stays final.
--   incentive_calc_approvals       each approval or rejection (with its reason), per submission and step.
--   incentive_calc_payouts         one per period (no duplicate payout): the payout reference, release date and the
--                                  run paid; incentive_calc_payout_lines: what each salesperson was paid.
--   These only RECORD a payout; no money is moved by the WMS.
--
-- No existing row is changed. 0132's tables gain nullable columns only (all empty in any database 0132 is in).
-- RLS on with no policies and the REST roles revoked, as for 0114 … 0132. Additive and safe to re-run.

-- ── inputs: retiring instead of editing ───────────────────────────────────────
ALTER TABLE "incentive_calc_attributions" ADD COLUMN IF NOT EXISTS "note" text;
ALTER TABLE "incentive_calc_attributions" ADD COLUMN IF NOT EXISTS "retired_at" timestamptz;
ALTER TABLE "incentive_calc_attributions" ADD COLUMN IF NOT EXISTS "retired_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL;
ALTER TABLE "incentive_calc_attributions" ADD COLUMN IF NOT EXISTS "retired_reason" text;
ALTER TABLE "incentive_calc_rep_history" ADD COLUMN IF NOT EXISTS "note" text;
ALTER TABLE "incentive_calc_rep_history" ADD COLUMN IF NOT EXISTS "retired_at" timestamptz;
ALTER TABLE "incentive_calc_rep_history" ADD COLUMN IF NOT EXISTS "retired_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL;
ALTER TABLE "incentive_calc_rep_history" ADD COLUMN IF NOT EXISTS "retired_reason" text;
ALTER TABLE "incentive_calc_receipt_events" ADD COLUMN IF NOT EXISTS "retired_at" timestamptz;
ALTER TABLE "incentive_calc_receipt_events" ADD COLUMN IF NOT EXISTS "retired_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL;
ALTER TABLE "incentive_calc_receipt_events" ADD COLUMN IF NOT EXISTS "retired_reason" text;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incentive_calc_attributions', 'incentive_calc_rep_history', 'incentive_calc_receipt_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_retired_check') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (("retired_at" IS NULL AND "retired_reason" IS NULL) OR ("retired_at" IS NOT NULL AND length(btrim(coalesce("retired_reason", ''''))) BETWEEN 1 AND 1000))', t, t || '_retired_check');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incentive_calc_attributions_note_check') THEN
    ALTER TABLE "incentive_calc_attributions" ADD CONSTRAINT "incentive_calc_attributions_note_check" CHECK ("note" IS NULL OR length("note") <= 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incentive_calc_rep_history_note_check') THEN
    ALTER TABLE "incentive_calc_rep_history" ADD CONSTRAINT "incentive_calc_rep_history_note_check" CHECK ("note" IS NULL OR length("note") <= 1000);
  END IF;
END
$$;

-- One ACTIVE attribution per order and salesperson (retired ones stay as history).
DROP INDEX IF EXISTS "incentive_calc_attributions_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_attributions_active_uq" ON "incentive_calc_attributions" ("document_id", "employee_id") WHERE "retired_at" IS NULL;
CREATE INDEX IF NOT EXISTS "incentive_calc_attributions_document_idx" ON "incentive_calc_attributions" ("document_id");

-- Receipt events: `hold` joins the kinds; one active marking of each single kind per document; one active allocation
-- per receipt and invoice.
ALTER TABLE "incentive_calc_receipt_events" DROP CONSTRAINT IF EXISTS "incentive_calc_receipt_events_kind_check";
ALTER TABLE "incentive_calc_receipt_events" ADD CONSTRAINT "incentive_calc_receipt_events_kind_check" CHECK ("kind" IN ('refund', 'bounced', 'reversed', 'allocation', 'salesReturn', 'hold'));
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_receipt_events_marking_uq" ON "incentive_calc_receipt_events" ("document_id", "kind") WHERE "retired_at" IS NULL AND "kind" IN ('bounced', 'reversed', 'salesReturn', 'hold');
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_receipt_events_allocation_uq" ON "incentive_calc_receipt_events" ("document_id", "invoice_document_id") WHERE "retired_at" IS NULL AND "kind" = 'allocation';

-- An input row accepts exactly two kinds of change: being retired once (retired_at / _by / _reason from empty, nothing
-- else), and an employee reference becoming NULL (ON DELETE SET NULL). Never deleted.
CREATE OR REPLACE FUNCTION "incentive_calc_input_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o jsonb;
  n jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An incentive input is never deleted; retire it instead' USING ERRCODE = 'restrict_violation';
  END IF;
  o := to_jsonb(OLD) - 'created_by_id' - 'retired_by_id';
  n := to_jsonb(NEW) - 'created_by_id' - 'retired_by_id';
  IF NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" AND NEW."created_by_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Who recorded an incentive input never changes' USING ERRCODE = 'restrict_violation';
  END IF;
  IF o = n THEN
    IF NEW."retired_by_id" IS DISTINCT FROM OLD."retired_by_id" AND NEW."retired_by_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Who retired an incentive input never changes' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."retired_at" IS NULL AND NEW."retired_at" IS NOT NULL
     AND (o - 'retired_at' - 'retired_reason') = (n - 'retired_at' - 'retired_reason') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'An incentive input never changes; retire it and record a new one' USING ERRCODE = 'restrict_violation';
END
$$;

-- Attributions: an order's active shares never exceed 100%.
CREATE OR REPLACE FUNCTION "incentive_calc_attributions_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_attributions'), hashtext(NEW."document_id"::text));
  IF NOT EXISTS (SELECT 1 FROM "tally_documents" WHERE "id" = NEW."document_id" AND "document_type" IN ('sales-orders', 'sales-invoices')) THEN
    RAISE EXCEPTION 'A salesperson is attributed to a Forms Sales Order or Sales Invoice only' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum("share_ppm"), 0) INTO total FROM "incentive_calc_attributions" WHERE "document_id" = NEW."document_id" AND "retired_at" IS NULL;
  IF total + NEW."share_ppm" > 1000000 THEN
    RAISE EXCEPTION 'The order''s salespeople would share more than 100%%' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- Representative history: a customer's active periods never overlap.
CREATE OR REPLACE FUNCTION "incentive_calc_rep_history_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_rep_history'), hashtext(NEW."customer_master_id"::text));
  IF EXISTS (
    SELECT 1 FROM "incentive_calc_rep_history" r
    WHERE r."customer_master_id" = NEW."customer_master_id" AND r."retired_at" IS NULL AND r."id" <> NEW."id"
      AND r."effective_from" <= coalesce(NEW."effective_to", 'infinity'::date)
      AND NEW."effective_from" <= coalesce(r."effective_to", 'infinity'::date)
  ) THEN
    RAISE EXCEPTION 'The customer already has a representative for part of that period' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END
$$;

-- Receipt events: the right kind of document; refunds and allocations by hand never exceed the receipt.
CREATE OR REPLACE FUNCTION "incentive_calc_receipt_events_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  dtype text;
  dtotal bigint;
  used bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_receipt_events'), hashtext(NEW."document_id"::text));
  SELECT "document_type", "total_paise" INTO dtype, dtotal FROM "tally_documents" WHERE "id" = NEW."document_id";
  IF NEW."kind" = 'salesReturn' THEN
    IF dtype IS DISTINCT FROM 'credit-notes' THEN
      RAISE EXCEPTION 'Only a Forms Credit Note can be marked as a sales return' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF dtype IS DISTINCT FROM 'customer-receipts' THEN
    RAISE EXCEPTION 'A % is recorded against a Forms Customer Receipt', NEW."kind" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'allocation' AND NOT EXISTS (SELECT 1 FROM "tally_documents" WHERE "id" = NEW."invoice_document_id" AND "document_type" = 'sales-invoices') THEN
    RAISE EXCEPTION 'A receipt is allocated to a Forms Sales Invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" IN ('refund', 'allocation') THEN
    SELECT coalesce(sum("amount_paise"), 0) INTO used FROM "incentive_calc_receipt_events" WHERE "document_id" = NEW."document_id" AND "kind" = NEW."kind" AND "retired_at" IS NULL;
    IF used + NEW."amount_paise" > dtotal THEN
      RAISE EXCEPTION 'The receipt''s % would exceed its amount', CASE NEW."kind" WHEN 'refund' THEN 'refunds' ELSE 'allocations' END USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "incentive_calc_attributions_guard" ON "incentive_calc_attributions";
CREATE TRIGGER "incentive_calc_attributions_guard" BEFORE UPDATE OR DELETE ON "incentive_calc_attributions" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_input_guard"();
DROP TRIGGER IF EXISTS "incentive_calc_attributions_insert" ON "incentive_calc_attributions";
CREATE TRIGGER "incentive_calc_attributions_insert" BEFORE INSERT ON "incentive_calc_attributions" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_attributions_check"();
DROP TRIGGER IF EXISTS "incentive_calc_rep_history_guard" ON "incentive_calc_rep_history";
CREATE TRIGGER "incentive_calc_rep_history_guard" BEFORE UPDATE OR DELETE ON "incentive_calc_rep_history" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_input_guard"();
DROP TRIGGER IF EXISTS "incentive_calc_rep_history_insert" ON "incentive_calc_rep_history";
CREATE TRIGGER "incentive_calc_rep_history_insert" BEFORE INSERT ON "incentive_calc_rep_history" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_rep_history_check"();
DROP TRIGGER IF EXISTS "incentive_calc_receipt_events_guard" ON "incentive_calc_receipt_events";
CREATE TRIGGER "incentive_calc_receipt_events_guard" BEFORE UPDATE OR DELETE ON "incentive_calc_receipt_events" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_input_guard"();
DROP TRIGGER IF EXISTS "incentive_calc_receipt_events_insert" ON "incentive_calc_receipt_events";
CREATE TRIGGER "incentive_calc_receipt_events_insert" BEFORE INSERT ON "incentive_calc_receipt_events" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_receipt_events_check"();

-- ── input history ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_input_history" (
  "event_no" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "entity" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "note" text,
  "actor_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL,
  "at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event')),
  CONSTRAINT "incentive_calc_input_history_action_check" CHECK ("action" IN ('record', 'retire')),
  CONSTRAINT "incentive_calc_input_history_note_check" CHECK ("note" IS NULL OR length("note") <= 1000)
);
CREATE INDEX IF NOT EXISTS "incentive_calc_input_history_entity_idx" ON "incentive_calc_input_history" ("entity", "entity_id", "event_no");
DROP TRIGGER IF EXISTS "incentive_calc_input_history_no_change" ON "incentive_calc_input_history";
CREATE TRIGGER "incentive_calc_input_history_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_input_history" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('actor_id');

-- ── periods: submission ───────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_periods" ADD COLUMN IF NOT EXISTS "submission_no" integer NOT NULL DEFAULT 0;
ALTER TABLE "incentive_calc_periods" ADD COLUMN IF NOT EXISTS "submitted_at" timestamptz;
ALTER TABLE "incentive_calc_periods" ADD COLUMN IF NOT EXISTS "submitted_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL;
ALTER TABLE "incentive_calc_periods" ADD COLUMN IF NOT EXISTS "approvals_required" integer;
ALTER TABLE "incentive_calc_periods" ADD COLUMN IF NOT EXISTS "release_on" date;
ALTER TABLE "incentive_calc_periods" ADD COLUMN IF NOT EXISTS "payout_reference" text;
ALTER TABLE "incentive_calc_periods" DROP CONSTRAINT IF EXISTS "incentive_calc_periods_status_check";
ALTER TABLE "incentive_calc_periods" ADD CONSTRAINT "incentive_calc_periods_status_check" CHECK ("status" IN ('open', 'locked', 'submitted', 'approved', 'paid'));
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incentive_calc_periods_submitted_check') THEN
    ALTER TABLE "incentive_calc_periods" ADD CONSTRAINT "incentive_calc_periods_submitted_check" CHECK ("status" NOT IN ('submitted', 'approved', 'paid') OR ("submitted_at" IS NOT NULL AND "approvals_required" BETWEEN 1 AND 3 AND "submission_no" >= 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incentive_calc_periods_release_check') THEN
    ALTER TABLE "incentive_calc_periods" ADD CONSTRAINT "incentive_calc_periods_release_check" CHECK ("status" NOT IN ('approved', 'paid') OR "release_on" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incentive_calc_periods_reference_check') THEN
    ALTER TABLE "incentive_calc_periods" ADD CONSTRAINT "incentive_calc_periods_reference_check" CHECK (("status" = 'paid') = ("payout_reference" IS NOT NULL) AND ("payout_reference" IS NULL OR length(btrim("payout_reference")) BETWEEN 1 AND 200));
  END IF;
END
$$;

-- ── approvals ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "period_id" uuid NOT NULL REFERENCES "incentive_calc_periods"("id") ON DELETE RESTRICT,
  "run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "submission_no" integer NOT NULL,
  "step_no" integer NOT NULL,
  "decision" text NOT NULL,
  "reason" text,
  "actor_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL,
  "at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_approvals_decision_check" CHECK ("decision" IN ('approve', 'reject')),
  CONSTRAINT "incentive_calc_approvals_reason_check" CHECK (("decision" = 'approve' AND ("reason" IS NULL OR length("reason") <= 1000)) OR ("decision" = 'reject' AND length(btrim(coalesce("reason", ''))) BETWEEN 1 AND 1000)),
  CONSTRAINT "incentive_calc_approvals_step_check" CHECK ("step_no" BETWEEN 1 AND 3 AND "submission_no" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_approvals_step_uq" ON "incentive_calc_approvals" ("period_id", "submission_no", "step_no");

-- An approval belongs to the period's CURRENT submission and run, comes in step order, is never by the submitter, and
-- never twice by the same person in one submission.
CREATE OR REPLACE FUNCTION "incentive_calc_approvals_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
  done integer;
BEGIN
  SELECT * INTO p FROM "incentive_calc_periods" WHERE "id" = NEW."period_id" FOR UPDATE;
  IF NOT FOUND OR p."status" <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted month is approved or rejected' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."submission_no" <> p."submission_no" OR NEW."run_id" <> p."current_run_id" THEN
    RAISE EXCEPTION 'An approval must be of the month''s current submission and calculation' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."actor_id" IS NULL OR NEW."actor_id" = p."submitted_by_id" THEN
    RAISE EXCEPTION 'The person who submitted a month never approves or rejects it' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "incentive_calc_approvals" WHERE "period_id" = NEW."period_id" AND "submission_no" = NEW."submission_no" AND "actor_id" = NEW."actor_id") THEN
    RAISE EXCEPTION 'Each approval step is by a different person' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO done FROM "incentive_calc_approvals" WHERE "period_id" = NEW."period_id" AND "submission_no" = NEW."submission_no";
  IF NEW."step_no" <> done + 1 OR NEW."step_no" > p."approvals_required" THEN
    RAISE EXCEPTION 'Approval step % is not the next one', NEW."step_no" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_approvals_insert" ON "incentive_calc_approvals";
CREATE TRIGGER "incentive_calc_approvals_insert" BEFORE INSERT ON "incentive_calc_approvals" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_approvals_check"();
DROP TRIGGER IF EXISTS "incentive_calc_approvals_no_change" ON "incentive_calc_approvals";
CREATE TRIGGER "incentive_calc_approvals_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_approvals" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('actor_id');

-- ── payouts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "period_id" uuid NOT NULL REFERENCES "incentive_calc_periods"("id") ON DELETE RESTRICT,
  "run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "reference" text NOT NULL,
  "release_on" date NOT NULL,
  "paid_on" date NOT NULL,
  "total_paise" bigint NOT NULL,
  "note" text,
  "recorded_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "recorded_by_name" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_payouts_reference_check" CHECK (length(btrim("reference")) BETWEEN 1 AND 200),
  CONSTRAINT "incentive_calc_payouts_total_check" CHECK ("total_paise" >= 0),
  CONSTRAINT "incentive_calc_payouts_note_check" CHECK ("note" IS NULL OR length("note") <= 1000)
);
-- No duplicate payout: one per period.
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_payouts_period_uq" ON "incentive_calc_payouts" ("period_id");

CREATE TABLE IF NOT EXISTS "incentive_calc_payout_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payout_id" uuid NOT NULL REFERENCES "incentive_calc_payouts"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "employee_name" text NOT NULL,
  "payable_paise" bigint NOT NULL,
  "adjustments_paise" bigint NOT NULL,
  "amount_paise" bigint NOT NULL,
  CONSTRAINT "incentive_calc_payout_lines_amount_check" CHECK ("amount_paise" = greatest(0, "payable_paise" + "adjustments_paise"))
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_payout_lines_uq" ON "incentive_calc_payout_lines" ("payout_id", "employee_id");

CREATE OR REPLACE FUNCTION "incentive_calc_payouts_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
BEGIN
  SELECT * INTO p FROM "incentive_calc_periods" WHERE "id" = NEW."period_id" FOR UPDATE;
  IF NOT FOUND OR p."status" <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved month is paid' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."run_id" <> p."current_run_id" THEN
    RAISE EXCEPTION 'A payout is of the month''s approved calculation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_payouts_insert" ON "incentive_calc_payouts";
CREATE TRIGGER "incentive_calc_payouts_insert" BEFORE INSERT ON "incentive_calc_payouts" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_payouts_check"();
DROP TRIGGER IF EXISTS "incentive_calc_payouts_no_change" ON "incentive_calc_payouts";
CREATE TRIGGER "incentive_calc_payouts_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_payouts" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('recorded_by_id');
DROP TRIGGER IF EXISTS "incentive_calc_payout_lines_no_change" ON "incentive_calc_payout_lines";
CREATE TRIGGER "incentive_calc_payout_lines_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_payout_lines" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id');

-- ── the period guard, now with submission ─────────────────────────────────────
CREATE OR REPLACE FUNCTION "incentive_calc_periods_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  o jsonb;
  n jsonb;
  approvals integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An incentive calculation period is never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'open' OR NEW."current_run_id" IS NOT NULL OR NEW."submission_no" <> 0 THEN
      RAISE EXCEPTION 'A calculation period starts open, with no run' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- An employee reference becoming NULL (ON DELETE SET NULL) is always accepted on its own.
  o := to_jsonb(OLD) - 'locked_by_id' - 'approved_by_id' - 'paid_by_id' - 'submitted_by_id';
  n := to_jsonb(NEW) - 'locked_by_id' - 'approved_by_id' - 'paid_by_id' - 'submitted_by_id';
  IF o = n AND (NEW."locked_by_id" IS NULL OR NEW."locked_by_id" = OLD."locked_by_id")
         AND (NEW."approved_by_id" IS NULL OR NEW."approved_by_id" = OLD."approved_by_id")
         AND (NEW."paid_by_id" IS NULL OR NEW."paid_by_id" = OLD."paid_by_id")
         AND (NEW."submitted_by_id" IS NULL OR NEW."submitted_by_id" = OLD."submitted_by_id") THEN
    RETURN NEW;
  END IF;
  IF NEW."program_id" <> OLD."program_id" OR NEW."category_code" <> OLD."category_code" OR NEW."month" <> OLD."month" THEN
    RAISE EXCEPTION 'A calculation period''s programme, category and month never change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'paid' THEN
    RAISE EXCEPTION 'A paid incentive month is final' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW."status" = OLD."status"
          OR (OLD."status" = 'open' AND NEW."status" = 'locked')
          OR (OLD."status" = 'locked' AND NEW."status" IN ('open', 'submitted'))
          OR (OLD."status" = 'submitted' AND NEW."status" IN ('locked', 'approved'))
          OR (OLD."status" = 'approved' AND NEW."status" = 'paid')) THEN
    RAISE EXCEPTION 'A calculation period can''t move from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  -- A submitted or approved month doesn't change; the one exception is a submitted month's row version going up when
  -- an intermediate approval is recorded (so a screen that read it before can't act on a stale view).
  IF OLD."status" IN ('submitted', 'approved') AND NEW."status" = OLD."status" THEN
    IF NOT (OLD."status" = 'submitted' AND (o - 'row_version' - 'updated_at') = (n - 'row_version' - 'updated_at')) THEN
      RAISE EXCEPTION 'A % incentive month doesn''t change', OLD."status" USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW."status" = 'submitted' AND OLD."status" = 'locked' AND NEW."submission_no" <> OLD."submission_no" + 1 THEN
    RAISE EXCEPTION 'A submission is numbered one after the last' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."submission_no" <> OLD."submission_no" AND NOT (NEW."status" = 'submitted' AND OLD."status" = 'locked') THEN
    RAISE EXCEPTION 'A submission number changes only when the month is submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'approved' THEN
    SELECT count(*) INTO approvals FROM "incentive_calc_approvals" WHERE "period_id" = NEW."id" AND "submission_no" = NEW."submission_no" AND "decision" = 'approve';
    IF approvals < OLD."approvals_required" OR EXISTS (SELECT 1 FROM "incentive_calc_approvals" WHERE "period_id" = NEW."id" AND "submission_no" = NEW."submission_no" AND "decision" = 'reject') THEN
      RAISE EXCEPTION 'A month is approved only with all % approvals of its submission', OLD."approvals_required" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."status" = 'paid' AND NOT EXISTS (SELECT 1 FROM "incentive_calc_payouts" WHERE "period_id" = NEW."id" AND "run_id" = NEW."current_run_id" AND "reference" = NEW."payout_reference") THEN
    RAISE EXCEPTION 'A month is paid only with its payout record' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."approvals_required" IS DISTINCT FROM OLD."approvals_required" AND NOT (NEW."status" = 'submitted' AND OLD."status" = 'locked') THEN
    RAISE EXCEPTION 'The approvals a month needs are fixed when it is submitted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."current_run_id" IS DISTINCT FROM OLD."current_run_id" THEN
    IF OLD."status" <> 'open' OR NEW."status" <> 'open' THEN
      RAISE EXCEPTION 'The adopted calculation changes only while the month is open' USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT "program_id", "category_code", "month", "status" INTO r FROM "incentive_calc_runs" WHERE "id" = NEW."current_run_id";
    IF NOT FOUND OR r."program_id" <> NEW."program_id" OR r."category_code" <> NEW."category_code" OR r."month" <> NEW."month" OR r."status" <> 'computed' THEN
      RAISE EXCEPTION 'The adopted calculation must be a computed run of the same programme, category and month' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."row_version" <> OLD."row_version" + 1 THEN
    RAISE EXCEPTION 'A calculation period''s row version must go up by one' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ── descriptions ──────────────────────────────────────────────────────────────
COMMENT ON TABLE "incentive_calc_input_history" IS 'Append-only record of every Category A input recorded or retired (attributions, representative history, receipt events), with before and after.';
COMMENT ON TABLE "incentive_calc_approvals" IS 'Each approval or rejection of a submitted Category A month, per submission and step; never by the submitter, never twice by one person in a submission.';
COMMENT ON TABLE "incentive_calc_payouts" IS 'The payout RECORD of an approved Category A month (reference, release and paid dates): one per month. The WMS moves no money.';
COMMENT ON TABLE "incentive_calc_payout_lines" IS 'What each salesperson was paid in a payout: payable + adjustments carried in, never below zero.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_input_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_payout_lines" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['incentive_calc_input_history', 'incentive_calc_approvals', 'incentive_calc_payouts', 'incentive_calc_payout_lines'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON SEQUENCE public.incentive_calc_input_history_event_no_seq FROM %I', r);
    END IF;
  END LOOP;
END
$$;
