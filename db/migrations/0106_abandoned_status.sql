-- 0106 — "Abandoned", a doer status.
--
-- Work that STOPPED and will not be finished. The vocabulary already had two
-- ways for work to end and neither said this: `approved` / `not_approved` are
-- the initiator's ruling on finished work, and `on_hold` is an instruction to
-- pause and resume. A doer who has given up on something had to leave it
-- sitting in the pending lane forever, which is how a task list stops being
-- believable.
--
-- It is a REPORT, not a ruling — which is why it joins the doer's own list
-- beside "Done" rather than the restricted verdicts. The doer may pick the
-- work back up again; that is the whole difference between abandoning
-- something and having it cancelled over your head.

-- ── 1. The task enum ──────────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so this line
-- is split out and run on its own by scripts/apply-all-migrations.ts. Do not
-- reformat it across lines — the splitter matches it as a single statement.
ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'abandoned';

-- ── 2. The admin-editable label + colour ──────────────────────────────────
-- Every live status has a `status_settings` row so its label and pill colour
-- can be changed without a deploy. `stone` is the grey that used to belong to
-- `cancelled`, which is retired and offered nowhere — Abandoned is the live
-- statement of the same idea, so it inherits the colour rather than borrowing
-- one that still means something else.
--
-- display_order 75 puts it after Done (70) and before the approval verdicts,
-- matching where it sits in the doer's picker.
INSERT INTO status_settings (status, label, color_token, display_order, active)
VALUES ('abandoned', 'Abandoned', 'stone', 75, true)
ON CONFLICT (status) DO NOTHING;

-- ── 3. The plan's working vocabulary ──────────────────────────────────────
-- `project_nodes.status` is guarded by a CHECK rather than the enum (see
-- 0103), so the list has to be restated. Dropped and re-added rather than
-- altered: Postgres has no ALTER CONSTRAINT for a CHECK expression.
--
-- NOT VALID for the same reason 0103 used it — the constraint applies to every
-- new and updated row without scanning the table, and no existing row can
-- violate it since this only ever ADDS an allowed value.
ALTER TABLE "project_nodes" DROP CONSTRAINT IF EXISTS "project_nodes_status_check";

DO $$ BEGIN
  ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_status_check" CHECK (
    status IS NULL OR status IN
    ('dont_know','not_started','initiated','follow_up','need_info','done','abandoned')
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
