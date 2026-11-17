-- 0130 Sales Order field help text — Admin & Master Setup → Sales Order Fields.
--
-- Depends on 0128 (sales_order_field_settings). Independent of every other
-- pending file. Never apply through `pnpm db:migrate`; apply this one file with
-- the role the app connects as (DATABASE_URL), through the hash-pinned apply
-- script, which also records it in __schema_applied.
--
-- WHY. The Sales Order field catalogue now holds every field of TallyPrime's
-- Sales Order matrix (353, in 38 sections), and administrators manage the
-- sections as well as the fields. Two things need the database:
--
--   1. HELP TEXT. An administrator's own description of a field or a section
--      has no column to live in. This adds one, nullable. Until this file is
--      applied the application simply offers no help-text editing; everything
--      else about the configuration works without it.
--
--   2. SECTION ROWS. A section's settings (display label, order, enabled /
--      disabled, and custom sections) are rows of this same table, keyed
--      "section_…", with the section's name in "section" — so they share the
--      settings' versioning, history and no-delete rule. The application always
--      writes that name; the check below makes the database insist on it too.
--
-- WHAT. One nullable column and two CHECK constraints on an existing table, and
-- comments. No table is created, no existing row is changed, no index, policy
-- or grant is touched (the table keeps RLS on with no policies and no REST
-- access, from 0128). Additive and safe to re-run.

ALTER TABLE "sales_order_field_settings" ADD COLUMN IF NOT EXISTS "help_text" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_field_settings_help_text_check' AND conrelid = 'public.sales_order_field_settings'::regclass) THEN
    ALTER TABLE "sales_order_field_settings"
      ADD CONSTRAINT "sales_order_field_settings_help_text_check" CHECK ("help_text" IS NULL OR length(btrim("help_text")) BETWEEN 1 AND 500);
  END IF;
  -- A section's row names its section, is never a custom field's row, and carries no field rule.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_field_settings_section_row_check' AND conrelid = 'public.sales_order_field_settings'::regclass) THEN
    ALTER TABLE "sales_order_field_settings"
      ADD CONSTRAINT "sales_order_field_settings_section_row_check" CHECK (
        "field_key" NOT LIKE 'section\_%'
        OR ("section" IS NOT NULL AND "requirement" IS NULL AND "condition" IS NULL AND "field_type" IS NULL AND "options" IS NULL)
      );
  END IF;
END
$$;

COMMENT ON COLUMN "sales_order_field_settings"."help_text" IS 'An administrator''s help text for the field or section (1–500 characters); NULL = none (a matrix field then shows its own rule).';
COMMENT ON TABLE "sales_order_field_settings" IS 'Sales Order field and section settings (Admin & Master Setup → Sales Order Fields). One row per field that has a setting, per custom field ("custom_…"), and per section that has a setting ("section_…", the section''s name in "section"). Rows are never deleted.';
