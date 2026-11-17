-- 0131 Incentive Rules configuration — Admin & Master Setup → Incentive Rules (Category A, Stage 3).
--
-- Depends on 0000 (employees). Independent of every other pending file. Never apply through `pnpm db:migrate`;
-- apply this one file with the role the app connects as (DATABASE_URL), through the hash-pinned apply script, which
-- also records it in __schema_applied.
--
-- WHY. Every Category A incentive rule must be configurable by authorised administrators, versioned, approved by a
-- second person, published with an effective date, and auditable — with no business rule in code. The settings'
-- VOCABULARY (which settings exist, their kinds and choices) is in lib/incentives/rules-config/spec.ts; their VALUES
-- live here.
--
-- WHY NEW TABLES (not incentive_schemes / rule_versions / scheme_assignments from 0068). The live Incentive Tracker
-- reads those: its publishScheme attaches a new rule_version to whichever incentive_schemes row a `limit 1` returns,
-- and getActiveSchemeConfig takes the newest rule_versions row of ANY scheme. A row added there would change what the
-- live tracker computes for its existing records (8 orders, 1 paid period). These tables are separate and nothing
-- that exists reads them, so the live tracker and every existing incentive record are untouched.
--
-- WHAT.
--   incentive_programs             an incentive programme (e.g. a sales team's scheme), created by administrators.
--   incentive_config_versions      one configuration of one category of a programme: draft → submitted → approved →
--                                  published (or rejected / discarded), with effective dates and who did each step.
--   incentive_config_settings      the version's setting values (one row per setting; keys from the catalogue only).
--   incentive_config_slabs         the version's incentive slabs.
--   incentive_config_delay_steps   the version's collection-delay steps.
--   incentive_config_eligibility   who the version covers: employees, departments or roles, included or excluded,
--                                  between dates.
--   incentive_config_history       append-only record of every change, with before and after.
--
-- RULES THE DATABASE ITSELF ENFORCES.
--   * A version is created only as a draft; its status moves only along the allowed transitions.
--   * Its settings, slabs, steps and eligibility can change only while it is a draft or rejected.
--   * A published or discarded version never changes — except the one end date publishing a later version sets (once,
--     from none), and an employee reference becoming empty when that employee is deleted (ON DELETE SET NULL).
--   * The approver is never the version's author or its submitter.
--   * Two published versions of one programme's category never cover the same day.
--   * Programmes, versions and their history are never deleted; the history never changes.
--
-- No existing table, row, index, policy or grant is changed. No row is inserted. RLS on with no policies and the REST
-- roles revoked, as for 0114 … 0130; the app connects as the owner. Additive and safe to re-run.

-- ── programmes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_programs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "row_version" integer NOT NULL DEFAULT 1,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_programs_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  CONSTRAINT "incentive_programs_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "incentive_programs_description_check" CHECK ("description" IS NULL OR length("description") <= 1000),
  CONSTRAINT "incentive_programs_version_check" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_programs_code_uq" ON "incentive_programs" ("code");

-- ── versions ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_config_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "incentive_programs"("id") ON DELETE RESTRICT,
  "category_code" text NOT NULL,
  "version_no" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "effective_from" date,
  "effective_to" date,
  "change_note" text,
  "rejection_reason" text,
  "row_version" integer NOT NULL DEFAULT 1,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "submitted_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "submitted_at" timestamptz,
  "approved_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "approved_at" timestamptz,
  "rejected_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "rejected_at" timestamptz,
  "published_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "published_at" timestamptz,
  CONSTRAINT "incentive_config_versions_category_check" CHECK ("category_code" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')),
  CONSTRAINT "incentive_config_versions_no_check" CHECK ("version_no" >= 1),
  CONSTRAINT "incentive_config_versions_status_check" CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected', 'published', 'discarded')),
  CONSTRAINT "incentive_config_versions_from_check" CHECK ("effective_from" IS NULL OR extract(day FROM "effective_from") = 1),
  CONSTRAINT "incentive_config_versions_to_check" CHECK ("effective_to" IS NULL OR ("effective_from" IS NOT NULL AND "effective_to" >= "effective_from")),
  CONSTRAINT "incentive_config_versions_published_check" CHECK ("status" <> 'published' OR ("effective_from" IS NOT NULL AND "published_at" IS NOT NULL AND "approved_at" IS NOT NULL)),
  CONSTRAINT "incentive_config_versions_approved_check" CHECK ("status" <> 'approved' OR "approved_at" IS NOT NULL),
  CONSTRAINT "incentive_config_versions_rejected_check" CHECK ("status" <> 'rejected' OR ("rejected_at" IS NOT NULL AND length(btrim(coalesce("rejection_reason", ''))) >= 1)),
  -- Maker-checker: the approver is never the author or the submitter.
  CONSTRAINT "incentive_config_versions_approver_check" CHECK (
    "approved_by_id" IS NULL
    OR ("approved_by_id" IS DISTINCT FROM "created_by_id" AND "approved_by_id" IS DISTINCT FROM "submitted_by_id")
  ),
  CONSTRAINT "incentive_config_versions_note_check" CHECK ("change_note" IS NULL OR length("change_note") <= 1000),
  CONSTRAINT "incentive_config_versions_reason_check" CHECK ("rejection_reason" IS NULL OR length("rejection_reason") <= 1000),
  CONSTRAINT "incentive_config_versions_row_version_check" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_config_versions_no_uq" ON "incentive_config_versions" ("program_id", "category_code", "version_no");
CREATE INDEX IF NOT EXISTS "incentive_config_versions_effective_idx" ON "incentive_config_versions" ("program_id", "category_code", "status", "effective_from");

-- ── a version's contents ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_config_settings" (
  "version_id" uuid NOT NULL REFERENCES "incentive_config_versions"("id") ON DELETE RESTRICT,
  "setting_key" text NOT NULL,
  "value" jsonb NOT NULL,
  PRIMARY KEY ("version_id", "setting_key"),
  -- Only the catalogue's settings (lib/incentives/rules-config/spec.ts); a value is a string, a number or a list.
  CONSTRAINT "incentive_config_settings_key_check" CHECK ("setting_key" IN (
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
    'payout.approvalSteps', 'payout.release'
  )),
  CONSTRAINT "incentive_config_settings_value_check" CHECK (jsonb_typeof("value") IN ('string', 'number', 'array'))
);

CREATE TABLE IF NOT EXISTS "incentive_config_slabs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_id" uuid NOT NULL REFERENCES "incentive_config_versions"("id") ON DELETE RESTRICT,
  "position" integer NOT NULL,
  "line_code" text NOT NULL,
  "label" text NOT NULL,
  "from_paise" bigint NOT NULL,
  "to_paise" bigint NOT NULL,
  "value_type" text NOT NULL,
  -- A percentage in parts per million (1% = 10,000), or a fixed amount in paise.
  "rate_ppm" integer,
  "fixed_paise" bigint,
  "cap_paise" bigint,
  CONSTRAINT "incentive_config_slabs_position_check" CHECK ("position" BETWEEN 1 AND 20),
  CONSTRAINT "incentive_config_slabs_code_check" CHECK ("line_code" ~ '^[A-Za-z0-9.\-]{1,10}$'),
  CONSTRAINT "incentive_config_slabs_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 120),
  CONSTRAINT "incentive_config_slabs_range_check" CHECK ("from_paise" >= 0 AND "to_paise" > "from_paise"),
  CONSTRAINT "incentive_config_slabs_value_check" CHECK (
    ("value_type" = 'percent' AND "rate_ppm" BETWEEN 0 AND 1000000 AND "fixed_paise" IS NULL)
    OR ("value_type" = 'fixed' AND "fixed_paise" >= 0 AND "rate_ppm" IS NULL)
  ),
  CONSTRAINT "incentive_config_slabs_cap_check" CHECK ("cap_paise" IS NULL OR "cap_paise" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_config_slabs_position_uq" ON "incentive_config_slabs" ("version_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_config_slabs_code_uq" ON "incentive_config_slabs" ("version_id", lower("line_code"));

CREATE TABLE IF NOT EXISTS "incentive_config_delay_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_id" uuid NOT NULL REFERENCES "incentive_config_versions"("id") ON DELETE RESTRICT,
  "position" integer NOT NULL,
  "from_days" integer NOT NULL,
  "to_days" integer,
  -- 100% = 1,000,000.
  "multiplier_ppm" integer NOT NULL,
  CONSTRAINT "incentive_config_delay_steps_position_check" CHECK ("position" BETWEEN 1 AND 10),
  CONSTRAINT "incentive_config_delay_steps_range_check" CHECK ("from_days" >= 0 AND ("to_days" IS NULL OR "to_days" > "from_days")),
  CONSTRAINT "incentive_config_delay_steps_multiplier_check" CHECK ("multiplier_ppm" BETWEEN 0 AND 1000000)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_config_delay_steps_position_uq" ON "incentive_config_delay_steps" ("version_id", "position");

CREATE TABLE IF NOT EXISTS "incentive_config_eligibility" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_id" uuid NOT NULL REFERENCES "incentive_config_versions"("id") ON DELETE RESTRICT,
  "position" integer NOT NULL,
  "subject_type" text NOT NULL,
  -- An employee's or department's id. Deliberately NO foreign key: a published version must stay exactly as it was
  -- approved even after the person or department is removed, and a foreign key's SET NULL would have to rewrite it.
  -- The name is kept beside it (subject_label); the application checks the id exists when the row is saved.
  "subject_id" uuid,
  "role" text,
  "subject_label" text NOT NULL,
  "mode" text NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  CONSTRAINT "incentive_config_eligibility_position_check" CHECK ("position" BETWEEN 1 AND 500),
  CONSTRAINT "incentive_config_eligibility_subject_check" CHECK (
    ("subject_type" IN ('employee', 'department') AND "subject_id" IS NOT NULL AND "role" IS NULL)
    OR ("subject_type" = 'role' AND "subject_id" IS NULL AND length(btrim(coalesce("role", ''))) >= 1)
  ),
  CONSTRAINT "incentive_config_eligibility_label_check" CHECK (length(btrim("subject_label")) BETWEEN 1 AND 160),
  CONSTRAINT "incentive_config_eligibility_mode_check" CHECK ("mode" IN ('include', 'exclude')),
  CONSTRAINT "incentive_config_eligibility_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_config_eligibility_position_uq" ON "incentive_config_eligibility" ("version_id", "position");

-- ── history ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incentive_config_history" (
  "event_no" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "program_id" uuid NOT NULL REFERENCES "incentive_programs"("id") ON DELETE RESTRICT,
  "version_id" uuid REFERENCES "incentive_config_versions"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "note" text,
  "actor_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "actor_name" text,
  "at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_config_history_action_check" CHECK ("action" IN (
    'create_program', 'update_program', 'create', 'edit', 'submit', 'withdraw', 'approve', 'reject',
    'return_to_draft', 'publish', 'supersede', 'discard'
  )),
  CONSTRAINT "incentive_config_history_note_check" CHECK ("note" IS NULL OR length("note") <= 1000)
);
CREATE INDEX IF NOT EXISTS "incentive_config_history_version_idx" ON "incentive_config_history" ("version_id", "event_no");
CREATE INDEX IF NOT EXISTS "incentive_config_history_program_idx" ON "incentive_config_history" ("program_id", "event_no");

-- ── triggers ──────────────────────────────────────────────────────────────────

-- Programmes are never deleted (deactivate them instead).
CREATE OR REPLACE FUNCTION "incentive_programs_refuse_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Incentive programmes are never deleted; deactivate the programme instead' USING ERRCODE = 'restrict_violation';
END
$$;
DROP TRIGGER IF EXISTS "incentive_programs_no_delete" ON "incentive_programs";
CREATE TRIGGER "incentive_programs_no_delete" BEFORE DELETE ON "incentive_programs" FOR EACH ROW EXECUTE FUNCTION "incentive_programs_refuse_delete"();

-- A version: created only as a draft; never deleted; its status moves only along the allowed transitions; once
-- published or discarded it never changes, except (published) an end date set once from none, and an employee
-- reference becoming empty when that employee is deleted.
CREATE OR REPLACE FUNCTION "incentive_config_versions_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o jsonb;
  n jsonb;
  k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Incentive configuration versions are never deleted; discard a draft instead' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft' THEN
      RAISE EXCEPTION 'An incentive configuration version is created as a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."program_id" <> OLD."program_id" OR NEW."category_code" <> OLD."category_code" OR NEW."version_no" <> OLD."version_no" THEN
    RAISE EXCEPTION 'A version''s programme, category and number never change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'draft' AND NEW."status" IN ('submitted', 'discarded'))
    OR (OLD."status" = 'submitted' AND NEW."status" IN ('draft', 'approved', 'rejected'))
    OR (OLD."status" = 'rejected' AND NEW."status" IN ('draft', 'submitted', 'discarded'))
    OR (OLD."status" = 'approved' AND NEW."status" IN ('published', 'draft'))
  ) THEN
    RAISE EXCEPTION 'A version can''t go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('published', 'discarded') THEN
    o := to_jsonb(OLD) - 'effective_to' - 'row_version' - 'updated_at' - 'updated_by_id';
    n := to_jsonb(NEW) - 'effective_to' - 'row_version' - 'updated_at' - 'updated_by_id';
    -- An employee reference may become empty (that employee was deleted); nothing else may change.
    FOREACH k IN ARRAY ARRAY['created_by_id', 'submitted_by_id', 'approved_by_id', 'rejected_by_id', 'published_by_id'] LOOP
      IF n -> k = 'null'::jsonb THEN
        o := o - k;
        n := n - k;
      END IF;
    END LOOP;
    IF o <> n THEN
      RAISE EXCEPTION 'A % incentive configuration version never changes', OLD."status" USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."effective_to" IS DISTINCT FROM OLD."effective_to" AND (OLD."status" <> 'published' OR OLD."effective_to" IS NOT NULL) THEN
      RAISE EXCEPTION 'A published version''s end date is set once, when a later version is published' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_config_versions_guard" ON "incentive_config_versions";
CREATE TRIGGER "incentive_config_versions_guard" BEFORE INSERT OR UPDATE OR DELETE ON "incentive_config_versions" FOR EACH ROW EXECUTE FUNCTION "incentive_config_versions_guard"();

-- Two published versions of one programme's category never cover the same day. Serialised per programme, so two
-- publications at once can't both pass.
CREATE OR REPLACE FUNCTION "incentive_config_versions_no_overlap"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'published' THEN
    PERFORM pg_advisory_xact_lock(hashtext('incentive_config_publish'), hashtext(NEW."program_id"::text || NEW."category_code"));
    IF EXISTS (
      SELECT 1 FROM "incentive_config_versions" v
      WHERE v."program_id" = NEW."program_id" AND v."category_code" = NEW."category_code" AND v."status" = 'published' AND v."id" <> NEW."id"
        AND daterange(v."effective_from", v."effective_to", '[]') && daterange(NEW."effective_from", NEW."effective_to", '[]')
    ) THEN
      RAISE EXCEPTION 'Another published version of this programme''s category already covers some of these dates' USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_config_versions_no_overlap" ON "incentive_config_versions";
CREATE TRIGGER "incentive_config_versions_no_overlap" BEFORE UPDATE ON "incentive_config_versions" FOR EACH ROW EXECUTE FUNCTION "incentive_config_versions_no_overlap"();

-- A version's contents change only while it is a draft or rejected.
CREATE OR REPLACE FUNCTION "incentive_config_contents_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  SELECT "status" INTO s FROM "incentive_config_versions" WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."version_id" ELSE NEW."version_id" END;
  IF s IS NULL OR s NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Only a draft (or rejected) version''s configuration can change; this one is %', coalesce(s, 'missing') USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."version_id" <> OLD."version_id" THEN
    RAISE EXCEPTION 'A setting never moves to another version' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
DROP TRIGGER IF EXISTS "incentive_config_settings_guard" ON "incentive_config_settings";
CREATE TRIGGER "incentive_config_settings_guard" BEFORE INSERT OR UPDATE OR DELETE ON "incentive_config_settings" FOR EACH ROW EXECUTE FUNCTION "incentive_config_contents_guard"();
DROP TRIGGER IF EXISTS "incentive_config_slabs_guard" ON "incentive_config_slabs";
CREATE TRIGGER "incentive_config_slabs_guard" BEFORE INSERT OR UPDATE OR DELETE ON "incentive_config_slabs" FOR EACH ROW EXECUTE FUNCTION "incentive_config_contents_guard"();
DROP TRIGGER IF EXISTS "incentive_config_delay_steps_guard" ON "incentive_config_delay_steps";
CREATE TRIGGER "incentive_config_delay_steps_guard" BEFORE INSERT OR UPDATE OR DELETE ON "incentive_config_delay_steps" FOR EACH ROW EXECUTE FUNCTION "incentive_config_contents_guard"();
DROP TRIGGER IF EXISTS "incentive_config_eligibility_guard" ON "incentive_config_eligibility";
CREATE TRIGGER "incentive_config_eligibility_guard" BEFORE INSERT OR UPDATE OR DELETE ON "incentive_config_eligibility" FOR EACH ROW EXECUTE FUNCTION "incentive_config_contents_guard"();

-- The history is append-only. The one change it accepts: actor_id becoming NULL when that employee is deleted.
CREATE OR REPLACE FUNCTION "incentive_config_history_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."actor_id" IS NOT NULL AND NEW."actor_id" IS NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Incentive configuration history is append-only' USING ERRCODE = 'restrict_violation';
END
$$;
DROP TRIGGER IF EXISTS "incentive_config_history_no_change" ON "incentive_config_history";
CREATE TRIGGER "incentive_config_history_no_change" BEFORE UPDATE OR DELETE ON "incentive_config_history" FOR EACH ROW EXECUTE FUNCTION "incentive_config_history_append_only"();

-- ── descriptions ──────────────────────────────────────────────────────────────
COMMENT ON TABLE "incentive_programs" IS 'Incentive programmes (Admin & Master Setup → Incentive Rules). Never deleted.';
COMMENT ON TABLE "incentive_config_versions" IS 'One configuration of one category of an incentive programme: draft → submitted → approved → published (or rejected / discarded), with effective dates. Published and discarded versions never change; never deleted.';
COMMENT ON COLUMN "incentive_config_versions"."effective_from" IS 'First day of the first month the version applies to (set when it is published).';
COMMENT ON COLUMN "incentive_config_versions"."effective_to" IS 'Last day it applies to; NULL = open-ended. Set once, when a later version is published.';
COMMENT ON TABLE "incentive_config_settings" IS 'A version''s setting values; keys from lib/incentives/rules-config/spec.ts. Amounts in paise, rates in parts per million.';
COMMENT ON TABLE "incentive_config_slabs" IS 'A version''s incentive slabs (amounts in paise; rate_ppm: 1% = 10,000).';
COMMENT ON TABLE "incentive_config_delay_steps" IS 'A version''s collection-delay steps (multiplier_ppm: 100% = 1,000,000). The last step is open-ended.';
COMMENT ON TABLE "incentive_config_eligibility" IS 'Who a version covers: employees, departments or roles, included or excluded, between dates. subject_id has no foreign key on purpose (a published version never changes).';
COMMENT ON TABLE "incentive_config_history" IS 'Append-only record of every Incentive Rules change, with before and after.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_config_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_config_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_config_slabs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_config_delay_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_config_eligibility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_config_history" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['incentive_programs', 'incentive_config_versions', 'incentive_config_settings', 'incentive_config_slabs', 'incentive_config_delay_steps', 'incentive_config_eligibility', 'incentive_config_history'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON SEQUENCE public.incentive_config_history_event_no_seq FROM %I', r);
    END IF;
  END LOOP;
END
$$;
