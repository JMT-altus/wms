-- 0132 Incentive calculation — Category A (Stage 4). Admin & Master Setup → Incentive Rules → Calculation.
--
-- Depends on 0000 (employees), the Forms import tables (tally_documents, customer_masters) and 0131 (incentive_programs,
-- incentive_config_versions). Never apply through `pnpm db:migrate`; apply this one file through a hash-pinned apply
-- script, which also records it in __schema_applied.
--
-- WHY. Category A is calculated from Forms' own Sales Orders, Sales Invoices, Customer Receipts and Credit Notes
-- (tally_documents) and the PUBLISHED Incentive Rules version in force for the month (0131). Nothing is copied into the
-- live tracker's customers / sales_orders / invoices / receipts tables (no duplicate commercial transaction), and
-- nothing here is read or written by the live tracker (incentive_periods / incentive_ledger / payout_runs are
-- untouched). Every calculation is kept, with its exact inputs, its configuration version, its engine version and
-- hashes of both, so any result can be reproduced and audited.
--
-- WHAT.
--   incentive_calc_periods          one row per programme, category and month: open → locked → approved → paid
--                                   (locked → open to reopen), and the calculation run currently adopted.
--   incentive_calc_runs             every calculation, never changed: inputs, result, hashes, version used, outcome.
--   incentive_calc_results          per run: each salesperson's sales, pool, earned, payable and pending amounts.
--   incentive_calc_order_credits    per run: each salesperson's share of each order and what it earned.
--   incentive_calc_receipt_credits  per run: each receipt applied to each invoice, its own delay and multiplier.
--   incentive_calc_adjustments      differences carried from a locked or paid month into an open one, negative
--                                   balances carried, written off or recovered — each one recorded once.
--   incentive_calc_attributions     per-order salesperson assignment (when the configuration says so).
--   incentive_calc_rep_history      a customer's sales representative over time (when the configuration says so).
--   incentive_calc_receipt_events   what Tally's import can't say: refunds, bounced cheques, reversals, allocations
--                                   by hand, credit notes that are sales returns.
--
-- RULES THE DATABASE ITSELF ENFORCES.
--   * Runs, results, credits and adjustments are append-only (the one change accepted: an employee or document
--     reference becoming NULL when that row is deleted — ON DELETE SET NULL).
--   * A run belongs to one programme, category A and one month (its first day).
--   * Within a run, a receipt's credited part on one invoice is credited at most once per salesperson; a salesperson
--     has one result and one credit per order.
--   * A period's status moves only open ↔ locked → approved → paid; it is never deleted.
--   * The adopted run changes only while the period is open, and must be a computed run of the same programme,
--     category and month. A locked period must have one. An approved or paid period never changes again (except an
--     employee reference becoming NULL); a paid one is final.
--   * An adjustment is recorded once per source run, salesperson and kind.
--
-- No existing table, row, index, policy or grant is changed. No row is inserted. RLS on with no policies and the REST
-- roles revoked, as for 0114 … 0131; the app connects as the owner. Additive and safe to re-run.

-- ── runs ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "incentive_programs"("id") ON DELETE RESTRICT,
  "category_code" text NOT NULL,
  "month" date NOT NULL,
  "as_of" date NOT NULL,
  "config_version_id" uuid REFERENCES "incentive_config_versions"("id") ON DELETE RESTRICT,
  "config_version_no" integer,
  "engine_version" text NOT NULL,
  "status" text NOT NULL,
  "adopted" boolean NOT NULL,
  "outcome" text NOT NULL,
  "inputs_hash" text NOT NULL,
  "result_hash" text NOT NULL,
  "inputs" jsonb NOT NULL,
  "result" jsonb NOT NULL,
  "computed_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "computed_by_name" text NOT NULL,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_runs_category_check" CHECK ("category_code" = 'A'),
  CONSTRAINT "incentive_calc_runs_month_check" CHECK (extract(day FROM "month") = 1),
  CONSTRAINT "incentive_calc_runs_as_of_check" CHECK ("as_of" >= "month"),
  CONSTRAINT "incentive_calc_runs_status_check" CHECK ("status" IN ('computed', 'blocked')),
  CONSTRAINT "incentive_calc_runs_computed_check" CHECK ("status" <> 'computed' OR ("config_version_id" IS NOT NULL AND "config_version_no" IS NOT NULL)),
  CONSTRAINT "incentive_calc_runs_adopted_check" CHECK (NOT "adopted" OR "status" = 'computed'),
  CONSTRAINT "incentive_calc_runs_hash_check" CHECK ("inputs_hash" ~ '^[0-9a-f]{64}$' AND "result_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "incentive_calc_runs_outcome_check" CHECK (length("outcome") BETWEEN 1 AND 2000),
  CONSTRAINT "incentive_calc_runs_name_check" CHECK (length(btrim("computed_by_name")) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS "incentive_calc_runs_period_idx" ON "incentive_calc_runs" ("program_id", "category_code", "month", "computed_at");

-- ── periods ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "incentive_programs"("id") ON DELETE RESTRICT,
  "category_code" text NOT NULL,
  "month" date NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "current_run_id" uuid REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "row_version" integer NOT NULL DEFAULT 1,
  "locked_at" timestamptz,
  "locked_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "approved_at" timestamptz,
  "approved_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "paid_at" timestamptz,
  "paid_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_periods_category_check" CHECK ("category_code" = 'A'),
  CONSTRAINT "incentive_calc_periods_month_check" CHECK (extract(day FROM "month") = 1),
  CONSTRAINT "incentive_calc_periods_status_check" CHECK ("status" IN ('open', 'locked', 'approved', 'paid')),
  CONSTRAINT "incentive_calc_periods_run_check" CHECK ("status" = 'open' OR "current_run_id" IS NOT NULL),
  CONSTRAINT "incentive_calc_periods_locked_check" CHECK ("status" = 'open' OR "locked_at" IS NOT NULL),
  CONSTRAINT "incentive_calc_periods_approved_check" CHECK ("status" NOT IN ('approved', 'paid') OR "approved_at" IS NOT NULL),
  CONSTRAINT "incentive_calc_periods_paid_check" CHECK ("status" <> 'paid' OR "paid_at" IS NOT NULL),
  CONSTRAINT "incentive_calc_periods_row_version_check" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_periods_month_uq" ON "incentive_calc_periods" ("program_id", "category_code", "month");

-- ── a run's results ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "employee_name" text NOT NULL,
  "sales_paise" bigint NOT NULL,
  "qualified" boolean NOT NULL,
  "pool_exact" text NOT NULL,
  "earned_exact" text NOT NULL,
  "payable_exact" text NOT NULL,
  "earned_paise" bigint NOT NULL,
  "payable_paise" bigint NOT NULL,
  "pending_paise" bigint NOT NULL,
  "projected_paise" bigint NOT NULL,
  "explanation" jsonb NOT NULL,
  CONSTRAINT "incentive_calc_results_amounts_check" CHECK ("earned_paise" >= 0 AND "payable_paise" >= 0 AND "payable_paise" <= "earned_paise" AND "pending_paise" = "earned_paise" - "payable_paise" AND "projected_paise" >= 0),
  CONSTRAINT "incentive_calc_results_exact_check" CHECK ("pool_exact" ~ '^-?[0-9]+(/[0-9]+)?$' AND "earned_exact" ~ '^-?[0-9]+(/[0-9]+)?$' AND "payable_exact" ~ '^-?[0-9]+(/[0-9]+)?$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_results_employee_uq" ON "incentive_calc_results" ("run_id", "employee_id");

CREATE TABLE IF NOT EXISTS "incentive_calc_order_credits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "document_id" uuid REFERENCES "tally_documents"("id") ON DELETE SET NULL,
  "document_type" text NOT NULL,
  "document_no" text NOT NULL,
  "share_ppm" integer NOT NULL,
  "value_paise" bigint NOT NULL,
  "collectible_paise" bigint NOT NULL,
  "collected_paise" bigint NOT NULL,
  "fully_collected" boolean NOT NULL,
  "takes_share" boolean NOT NULL,
  "allocated_exact" text NOT NULL,
  "earned_exact" text NOT NULL,
  "payable_exact" text NOT NULL,
  "explanation" jsonb NOT NULL,
  CONSTRAINT "incentive_calc_order_credits_type_check" CHECK ("document_type" IN ('sales-orders', 'sales-invoices')),
  CONSTRAINT "incentive_calc_order_credits_share_check" CHECK ("share_ppm" BETWEEN 1 AND 1000000)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_order_credits_uq" ON "incentive_calc_order_credits" ("run_id", "employee_id", "document_id");

CREATE TABLE IF NOT EXISTS "incentive_calc_receipt_credits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "receipt_document_id" uuid REFERENCES "tally_documents"("id") ON DELETE SET NULL,
  "invoice_document_id" uuid REFERENCES "tally_documents"("id") ON DELETE SET NULL,
  "unit_document_id" uuid REFERENCES "tally_documents"("id") ON DELETE SET NULL,
  "receipt_no" text NOT NULL,
  "receipt_date" date NOT NULL,
  "amount_paise" bigint NOT NULL,
  "reference_date" date,
  "delay_days" integer,
  "multiplier_ppm" integer,
  "earned_exact" text NOT NULL,
  "status" text NOT NULL,
  "note" text NOT NULL,
  CONSTRAINT "incentive_calc_receipt_credits_status_check" CHECK ("status" IN ('credited', 'held', 'excluded', 'reversed', 'over-collected')),
  CONSTRAINT "incentive_calc_receipt_credits_amount_check" CHECK ("amount_paise" >= 0),
  CONSTRAINT "incentive_calc_receipt_credits_multiplier_check" CHECK ("multiplier_ppm" IS NULL OR "multiplier_ppm" BETWEEN 0 AND 1000000),
  CONSTRAINT "incentive_calc_receipt_credits_delay_check" CHECK ("delay_days" IS NULL OR "delay_days" >= 0)
);
-- No duplicate credit: one credited part of a receipt on an invoice per salesperson per run.
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_receipt_credits_uq" ON "incentive_calc_receipt_credits" ("run_id", "receipt_document_id", "invoice_document_id", "employee_id") NULLS NOT DISTINCT WHERE "status" = 'credited';
CREATE INDEX IF NOT EXISTS "incentive_calc_receipt_credits_run_idx" ON "incentive_calc_receipt_credits" ("run_id", "employee_id");

-- ── adjustments ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "incentive_programs"("id") ON DELETE RESTRICT,
  "category_code" text NOT NULL,
  "from_month" date NOT NULL,
  "to_month" date,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "employee_name" text NOT NULL,
  "kind" text NOT NULL,
  "amount_paise" bigint NOT NULL,
  "months_left" integer,
  "source_run_id" uuid NOT NULL REFERENCES "incentive_calc_runs"("id") ON DELETE RESTRICT,
  "note" text NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_adjustments_category_check" CHECK ("category_code" = 'A'),
  CONSTRAINT "incentive_calc_adjustments_kind_check" CHECK ("kind" IN ('recalc-difference', 'negative-carry', 'write-off', 'salary-recovery')),
  CONSTRAINT "incentive_calc_adjustments_month_check" CHECK (extract(day FROM "from_month") = 1 AND ("to_month" IS NULL OR (extract(day FROM "to_month") = 1 AND "to_month" > "from_month"))),
  CONSTRAINT "incentive_calc_adjustments_target_check" CHECK (("kind" IN ('recalc-difference', 'negative-carry')) = ("to_month" IS NOT NULL)),
  CONSTRAINT "incentive_calc_adjustments_amount_check" CHECK ("amount_paise" <> 0),
  CONSTRAINT "incentive_calc_adjustments_months_check" CHECK ("months_left" IS NULL OR "months_left" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_adjustments_once_uq" ON "incentive_calc_adjustments" ("source_run_id", "employee_id", "kind") NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS "incentive_calc_adjustments_to_idx" ON "incentive_calc_adjustments" ("program_id", "category_code", "to_month");

-- ── inputs the import can't give ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_calc_attributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "tally_documents"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "share_ppm" integer NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_attributions_share_check" CHECK ("share_ppm" BETWEEN 1 AND 1000000)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_attributions_uq" ON "incentive_calc_attributions" ("document_id", "employee_id");

CREATE TABLE IF NOT EXISTS "incentive_calc_rep_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_master_id" uuid NOT NULL REFERENCES "customer_masters"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_rep_history_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE INDEX IF NOT EXISTS "incentive_calc_rep_history_customer_idx" ON "incentive_calc_rep_history" ("customer_master_id", "effective_from");

CREATE TABLE IF NOT EXISTS "incentive_calc_receipt_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "tally_documents"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL,
  "invoice_document_id" uuid REFERENCES "tally_documents"("id") ON DELETE RESTRICT,
  "amount_paise" bigint,
  "event_date" date NOT NULL,
  "note" text,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_receipt_events_kind_check" CHECK ("kind" IN ('refund', 'bounced', 'reversed', 'allocation', 'salesReturn')),
  CONSTRAINT "incentive_calc_receipt_events_amount_check" CHECK (
    ("kind" IN ('refund', 'allocation') AND "amount_paise" > 0) OR ("kind" NOT IN ('refund', 'allocation') AND "amount_paise" IS NULL)
  ),
  CONSTRAINT "incentive_calc_receipt_events_invoice_check" CHECK (("kind" = 'allocation') = ("invoice_document_id" IS NOT NULL)),
  CONSTRAINT "incentive_calc_receipt_events_note_check" CHECK ("note" IS NULL OR length("note") <= 1000)
);
CREATE INDEX IF NOT EXISTS "incentive_calc_receipt_events_document_idx" ON "incentive_calc_receipt_events" ("document_id");

-- ── guards ────────────────────────────────────────────────────────────────────
-- Append-only. The one change accepted: the columns named as the trigger's arguments becoming NULL (ON DELETE SET NULL
-- of an employee or a document), with nothing else changing.
CREATE OR REPLACE FUNCTION "incentive_calc_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c text;
  o jsonb;
  n jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    o := to_jsonb(OLD);
    n := to_jsonb(NEW);
    FOREACH c IN ARRAY TG_ARGV LOOP
      IF n -> c = 'null'::jsonb THEN
        o := o - c;
        n := n - c;
      END IF;
    END LOOP;
    IF o = n THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_runs_no_change" ON "incentive_calc_runs";
CREATE TRIGGER "incentive_calc_runs_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_runs" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('computed_by_id');
DROP TRIGGER IF EXISTS "incentive_calc_results_no_change" ON "incentive_calc_results";
CREATE TRIGGER "incentive_calc_results_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_results" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id');
DROP TRIGGER IF EXISTS "incentive_calc_order_credits_no_change" ON "incentive_calc_order_credits";
CREATE TRIGGER "incentive_calc_order_credits_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_order_credits" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id', 'document_id');
DROP TRIGGER IF EXISTS "incentive_calc_receipt_credits_no_change" ON "incentive_calc_receipt_credits";
CREATE TRIGGER "incentive_calc_receipt_credits_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_receipt_credits" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id', 'receipt_document_id', 'invoice_document_id', 'unit_document_id');
DROP TRIGGER IF EXISTS "incentive_calc_adjustments_no_change" ON "incentive_calc_adjustments";
CREATE TRIGGER "incentive_calc_adjustments_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_adjustments" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id', 'created_by_id');

-- Periods: allowed status moves, the adopted run only while open, approved/paid frozen, never deleted.
CREATE OR REPLACE FUNCTION "incentive_calc_periods_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  o jsonb;
  n jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An incentive calculation period is never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'open' OR NEW."current_run_id" IS NOT NULL THEN
      RAISE EXCEPTION 'A calculation period starts open, with no run' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- An employee reference becoming NULL (ON DELETE SET NULL) is always accepted on its own.
  o := to_jsonb(OLD) - 'locked_by_id' - 'approved_by_id' - 'paid_by_id';
  n := to_jsonb(NEW) - 'locked_by_id' - 'approved_by_id' - 'paid_by_id';
  IF o = n AND (NEW."locked_by_id" IS NULL OR NEW."locked_by_id" = OLD."locked_by_id")
         AND (NEW."approved_by_id" IS NULL OR NEW."approved_by_id" = OLD."approved_by_id")
         AND (NEW."paid_by_id" IS NULL OR NEW."paid_by_id" = OLD."paid_by_id") THEN
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
          OR (OLD."status" = 'locked' AND NEW."status" IN ('open', 'approved'))
          OR (OLD."status" = 'approved' AND NEW."status" = 'paid')) THEN
    RAISE EXCEPTION 'A calculation period can''t move from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'approved' AND NEW."status" = 'approved' THEN
    RAISE EXCEPTION 'An approved incentive month doesn''t change' USING ERRCODE = 'restrict_violation';
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
DROP TRIGGER IF EXISTS "incentive_calc_periods_guard" ON "incentive_calc_periods";
CREATE TRIGGER "incentive_calc_periods_guard" BEFORE INSERT OR UPDATE OR DELETE ON "incentive_calc_periods" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_periods_guard"();

-- ── descriptions ──────────────────────────────────────────────────────────────
COMMENT ON TABLE "incentive_calc_runs" IS 'Every Category A calculation, never changed: exact inputs, result, sha256 of both, configuration version and engine version used, and whether it was adopted.';
COMMENT ON TABLE "incentive_calc_periods" IS 'One per programme, category and month: open ↔ locked → approved → paid, and the adopted run. Paid is final; never deleted.';
COMMENT ON TABLE "incentive_calc_results" IS 'Per run and salesperson: sales, pool, earned, payable and pending (paise; *_exact are exact fractions "n/d").';
COMMENT ON TABLE "incentive_calc_order_credits" IS 'Per run: each salesperson''s share of each order or invoice and what it earned.';
COMMENT ON TABLE "incentive_calc_receipt_credits" IS 'Per run: each receipt applied to an invoice at its own date, delay and multiplier.';
COMMENT ON TABLE "incentive_calc_adjustments" IS 'Differences from locked or paid months and negative balances, each recorded once (source run, salesperson, kind).';
COMMENT ON TABLE "incentive_calc_attributions" IS 'Per-order salesperson assignment, used when attribution.source = attributionRecord.';
COMMENT ON TABLE "incentive_calc_rep_history" IS 'A customer''s sales representative over time, used when attribution.historical = repAtOrderDate.';
COMMENT ON TABLE "incentive_calc_receipt_events" IS 'Refunds, bounced cheques, reversals and allocations by hand of receipts; credit notes that are sales returns.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_order_credits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_receipt_credits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_attributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_rep_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_calc_receipt_events" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['incentive_calc_runs', 'incentive_calc_periods', 'incentive_calc_results', 'incentive_calc_order_credits', 'incentive_calc_receipt_credits', 'incentive_calc_adjustments', 'incentive_calc_attributions', 'incentive_calc_rep_history', 'incentive_calc_receipt_events'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
