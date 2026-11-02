-- 0124 — DCC: how each KPI is answered, and what its target is per.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0099 (dcc_kpi_items). Additive,
-- idempotent (IF NOT EXISTS / existence checks), no data change, nothing
-- dropped. Written defensively like every migration from 0023+.
--
-- Why: the employee-wise checklist grid answers each KPI in the form the sheet
-- uses — a number ("Total Value of SO Recd"), Yes/No ("Weekly Calls Sheet
-- Done?") or free text ("To whom & what brand?") — and totals the week. The
-- stored fill already has the three shapes (value_number / status / note);
-- what was missing is WHICH shape a KPI expects, so the grid can show the
-- right cell and total the right thing.
--
--   input_type     'number' | 'yesno' | 'text'. Default 'yesno': every existing
--                  KPI is a Done / Not done checklist line today, and that is
--                  exactly what Y/N stores (status), so nothing changes for them.
--   target_period  'day' | 'week' | 'month': what `target_number` is per.
--                  Default 'day' keeps the existing meaning of the field.
--
-- Access: 0099 created the DCC tables without RLS or REST revokes (the app
-- reads and writes them only from the server as its own role); a new column
-- on the same table changes nothing about that, so no grant is added here.

ALTER TABLE dcc_kpi_items ADD COLUMN IF NOT EXISTS input_type text NOT NULL DEFAULT 'yesno';
ALTER TABLE dcc_kpi_items ADD COLUMN IF NOT EXISTS target_period text NOT NULL DEFAULT 'day';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dcc_kpi_items_input_type_check' AND conrelid = 'public.dcc_kpi_items'::regclass
  ) THEN
    ALTER TABLE dcc_kpi_items ADD CONSTRAINT dcc_kpi_items_input_type_check
      CHECK (input_type IN ('number', 'yesno', 'text'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dcc_kpi_items_target_period_check' AND conrelid = 'public.dcc_kpi_items'::regclass
  ) THEN
    ALTER TABLE dcc_kpi_items ADD CONSTRAINT dcc_kpi_items_target_period_check
      CHECK (target_period IN ('day', 'week', 'month'));
  END IF;
END
$$;
