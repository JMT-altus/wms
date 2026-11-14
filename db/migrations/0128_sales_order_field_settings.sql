-- 0128 Sales Order field settings — Admin & Master Setup → Sales Order Fields.
--
-- Depends on 0000 (employees) and 0122 (tally_import_batches). Independent of
-- every other pending file. Never apply through `pnpm db:migrate`; apply this
-- one file with the role the app connects as (DATABASE_URL), through the
-- hash-pinned apply script, which also records it in __schema_applied.
--
-- WHY. The Sales Order fields (TallyPrime's Sales Order matrix, 90 fields, in
-- lib/tally/sales-order-catalogue.ts) are configurable by authorised
-- administrators: label, section, display order, mandatory / optional /
-- conditional, the condition (from a fixed, safe vocabulary — never executable
-- text), form / import / order-page availability, allowed values, retirement,
-- and new custom fields at every scope (order, ledger entry, product line,
-- allocation, additional cost). The settings need a home; nothing existing fits.
--
-- WHAT.
--   sales_order_field_settings   one row per field that has a setting, or per
--                                custom field. A field with no row uses the
--                                matrix's own rules (code) — nothing is seeded.
--                                Rows are NEVER deleted (trigger): a field is
--                                retired instead, so a stored value always has
--                                its definition.
--   sales_order_field_history    append-only (trigger) record of every change:
--                                who, when, before and after. Its identity is
--                                the CONFIGURATION VERSION. The one change it
--                                accepts is changed_by_id becoming NULL when
--                                that employee is deleted (ON DELETE SET NULL).
--   tally_import_batches.field_config_version
--                                the configuration version an import validated
--                                against; an import is refused if it changed.
-- Custom field VALUES are not stored here: they live in the order itself
-- (tally_documents.details / lines, jsonb, 0122/0127) under `custom`, so no
-- further migration is needed when a field is added, and retiring a field
-- never touches stored values.
--
-- No existing row is changed. No direct REST access: RLS on with no policies,
-- REST roles revoked (pattern of 0114 … 0126). Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "sales_order_field_settings" (
  -- The catalogue's key for a matrix field; "custom_…" for a custom field.
  "field_key" text PRIMARY KEY,
  "is_custom" boolean NOT NULL DEFAULT false,
  -- voucher = the order (incl. buyer, consignee, order details, dispatch, states);
  -- ledger = a ledger entry (incl. its cost-centre allocations); item = a product line;
  -- allocation = an item allocation; additionalCost = an additional cost.
  "scope" text NOT NULL,
  -- Overrides; NULL = the matrix default.
  "label" text,
  "section" text,
  "display_order" integer,
  -- mandatory / optional / conditional (with "condition"); NULL = the matrix default.
  "requirement" text,
  -- The condition, from a fixed vocabulary validated by the application
  -- (lib/tally/sales-order-config.ts): {"op":"in"|"notIn","field":…,"values":[…]},
  -- {"op":"given","field":…}, {"op":"ledgerKind","values":["customer"|"other"]}.
  "condition" jsonb,
  -- Custom fields only (a matrix field's type and values come from Tally).
  "field_type" text,
  -- Allowed values: a custom choice field's list, or a subset of a matrix field's values.
  "options" text[],
  "in_form" boolean NOT NULL DEFAULT true,
  "in_import" boolean NOT NULL DEFAULT true,
  "on_order_page" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL DEFAULT 'active',
  -- Optimistic concurrency: a save names the version it read.
  "row_version" integer NOT NULL DEFAULT 1,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sales_order_field_settings_key_check" CHECK ("field_key" ~ '^[a-z][A-Za-z0-9_]{1,62}$'),
  CONSTRAINT "sales_order_field_settings_custom_key_check" CHECK ("is_custom" = ("field_key" LIKE 'custom\_%')),
  CONSTRAINT "sales_order_field_settings_scope_check" CHECK ("scope" IN ('voucher', 'ledger', 'item', 'allocation', 'additionalCost')),
  CONSTRAINT "sales_order_field_settings_label_check" CHECK ("label" IS NULL OR length(btrim("label")) BETWEEN 1 AND 120),
  CONSTRAINT "sales_order_field_settings_section_check" CHECK ("section" IS NULL OR length(btrim("section")) BETWEEN 1 AND 120),
  CONSTRAINT "sales_order_field_settings_order_check" CHECK ("display_order" IS NULL OR "display_order" BETWEEN 0 AND 100000),
  CONSTRAINT "sales_order_field_settings_requirement_check" CHECK ("requirement" IS NULL OR "requirement" IN ('mandatory', 'optional', 'conditional')),
  CONSTRAINT "sales_order_field_settings_condition_check" CHECK (
    ("requirement" IS DISTINCT FROM 'conditional' AND "condition" IS NULL)
    OR ("requirement" = 'conditional' AND coalesce(jsonb_typeof("condition"), '') = 'object')
  ),
  CONSTRAINT "sales_order_field_settings_type_check" CHECK ("field_type" IS NULL OR "field_type" IN ('text', 'date', 'amount', 'number', 'percent', 'yesno', 'choice')),
  CONSTRAINT "sales_order_field_settings_custom_complete_check" CHECK (NOT "is_custom" OR ("label" IS NOT NULL AND "section" IS NOT NULL AND "field_type" IS NOT NULL)),
  CONSTRAINT "sales_order_field_settings_matrix_type_check" CHECK ("is_custom" OR "field_type" IS NULL),
  CONSTRAINT "sales_order_field_settings_choice_check" CHECK (NOT "is_custom" OR "field_type" <> 'choice' OR coalesce(cardinality("options"), 0) >= 1),
  CONSTRAINT "sales_order_field_settings_options_check" CHECK ("options" IS NULL OR cardinality("options") BETWEEN 1 AND 200),
  CONSTRAINT "sales_order_field_settings_status_check" CHECK ("status" IN ('active', 'retired')),
  CONSTRAINT "sales_order_field_settings_version_check" CHECK ("row_version" >= 1)
);

-- Two custom fields can't share a label: the label is the custom field's column heading in an import file.
CREATE UNIQUE INDEX IF NOT EXISTS "sales_order_field_settings_custom_label_uq"
  ON "sales_order_field_settings" (lower(btrim("label"))) WHERE "is_custom";

CREATE TABLE IF NOT EXISTS "sales_order_field_history" (
  -- The configuration version: every change is one new version.
  "version" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "field_key" text NOT NULL REFERENCES "sales_order_field_settings"("field_key") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "before" jsonb,
  "after" jsonb NOT NULL,
  "changed_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sales_order_field_history_action_check" CHECK ("action" IN ('create', 'update', 'retire', 'restore'))
);

CREATE INDEX IF NOT EXISTS "sales_order_field_history_field_idx" ON "sales_order_field_history" ("field_key", "version" DESC);

-- A field's settings row is never deleted (retire it instead); the history is never changed or deleted.
CREATE OR REPLACE FUNCTION "sales_order_field_settings_refuse_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sales Order field settings are never deleted; retire the field instead' USING ERRCODE = 'restrict_violation';
END
$$;
DROP TRIGGER IF EXISTS "sales_order_field_settings_no_delete" ON "sales_order_field_settings";
CREATE TRIGGER "sales_order_field_settings_no_delete" BEFORE DELETE ON "sales_order_field_settings" FOR EACH ROW EXECUTE FUNCTION "sales_order_field_settings_refuse_delete"();

CREATE OR REPLACE FUNCTION "sales_order_field_history_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The one permitted change: deleting an employee clears changed_by_id (its ON DELETE SET NULL). Every other
  -- column must stay exactly as it was; any other UPDATE, and every DELETE, is refused.
  IF TG_OP = 'UPDATE' AND OLD."changed_by_id" IS NOT NULL AND NEW."changed_by_id" IS NULL
     AND (to_jsonb(NEW) - 'changed_by_id') = (to_jsonb(OLD) - 'changed_by_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Sales Order field history is append-only' USING ERRCODE = 'restrict_violation';
END
$$;
DROP TRIGGER IF EXISTS "sales_order_field_history_no_change" ON "sales_order_field_history";
CREATE TRIGGER "sales_order_field_history_no_change" BEFORE UPDATE OR DELETE ON "sales_order_field_history" FOR EACH ROW EXECUTE FUNCTION "sales_order_field_history_append_only"();

ALTER TABLE "tally_import_batches" ADD COLUMN IF NOT EXISTS "field_config_version" bigint;
COMMENT ON COLUMN "tally_import_batches"."field_config_version" IS 'Sales Orders: the Sales Order field configuration version (sales_order_field_history) the import was validated against. NULL for other categories and earlier imports.';

ALTER TABLE "sales_order_field_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_order_field_history" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.sales_order_field_settings FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE public.sales_order_field_history FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE public.sales_order_field_history_version_seq FROM %I', r);
    END IF;
  END LOOP;
END
$$;
