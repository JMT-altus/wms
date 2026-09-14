-- 0103 — Project Plan module.
--
-- Extends the EXISTING `project_nodes` tree (created by 0027, widened by 0041)
-- from three levels to six — Project → Milestone → Result → Action →
-- Sub-Action → Sub-Sub-Action — and gives it the plan metadata the four plan
-- surfaces (hierarchy table, registers, kanban, tree view) read.
--
-- Nothing here rewrites existing behaviour: every column is nullable, every
-- table is new, and the /projects workspace keeps selecting exactly the
-- columns it always did. Written defensively (add-column-if-not-exists) like
-- every migration from 0023+, so apply-all-migrations.ts can re-run it against
-- a populated database.
--
-- `kind` stays PLAIN TEXT with no check constraint, deliberately: a real enum
-- needs a lock plus a follow-up migration every time a level is added, and
-- 'sub_sub_action' is the second level added to this table already. The
-- app-side zod enum (lib/plan/levels.ts) is what validates writes.
--
-- ── What is deliberately NOT a column here, so nobody adds it later ────────
--
--   Project No / Ref   Derived from sibling position (lib/plan/levels.ts
--                      refFor/fullRefFor). A stored label drifts from the tree
--                      the first time a row is deleted.
--   Duration (days)    Derived from starts_at → ends_at (durationDays). Storing
--                      it lets it disagree with its own two endpoints.
--   Progress %         Derived from the work underneath (lib/plan/progress.ts),
--                      EXCEPT where a person recorded a partial — that is the
--                      progress_percent override below, and only that.
--   archived as a      It is `is_archived`, which already has a column, an
--   status string      index and a filter on every read. A parallel string
--                      could disagree with it.

-- ── 1. Plan / schedule ────────────────────────────────────────────────────
-- On a row with a linked task these are mirrored ONTO that task on every write
-- (syncNodeTask), so the task stays the single execution record. Project and
-- Milestone never carry them: those two are dated by the work underneath them.
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "purpose" text;
-- WHOLE MINUTES ("2h 30m" → 150) — the same unit as tasks.estimated_minutes,
-- so the mirror is a copy and never a conversion.
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "duration_minutes" integer;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "starts_at" timestamptz;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "ends_at" timestamptz;

-- ── 2. Status — two flows, never collapsed ────────────────────────────────
-- `status` describes CONTAINER rows (project / milestone / result). An
-- executable row's status of record stays on its LINKED TASK: a second column
-- here would be a copy free to disagree with it.
-- `approval_status` is the restricted verdict and applies to either kind of
-- row; it is layered ON TOP of the working status, never overwriting it, so
-- "approved" does not erase the fact that the work was at Follow Up when the
-- verdict landed.
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "approval_status" text;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "progress_percent" integer;

-- ── 3. Intake fields ──────────────────────────────────────────────────────
-- These exist because a CONTAINER row has no task to carry them, and the
-- create dialog collects them for every level. On an executable row the
-- equivalents live on the task (title / subject / priority / initiator /
-- tags) and these stay null.
--
-- `links` is a COLUMN, not a marker in the notes prose: rendering a Links cell
-- out of free text means parsing on every row, and a note containing "Links:"
-- would sprout links nobody added. Every entry is validated `^https?://`
-- server-side before it is stored.
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "client_name" text;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "subject" text;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "priority" text;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "initiator_id" uuid;
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "tags" text[];
ALTER TABLE "project_nodes" ADD COLUMN IF NOT EXISTS "links" text[];

DO $$ BEGIN
  ALTER TABLE "project_nodes"
    ADD CONSTRAINT "project_nodes_initiator_id_employees_id_fk"
    FOREIGN KEY ("initiator_id") REFERENCES "employees"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Guard the two vocabularies at the database as well as in zod ───────
-- A bad write from a script or a psql session must fail HERE, not leave a row
-- the app cannot render. NOT VALID so they apply to every new and updated row
-- without scanning the table — the existing rows have all three columns NULL
-- anyway, since this migration is what creates them.
DO $$ BEGIN
  ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_status_check" CHECK (
    status IS NULL OR status IN
    ('dont_know','not_started','initiated','follow_up','need_info','done')
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_approval_status_check" CHECK (
    approval_status IS NULL OR approval_status IN
    ('not_approved','approved','on_hold','cancelled')
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_progress_percent_check" CHECK (
    progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Indexes — each backs a real screen ─────────────────────────────────
-- project_nodes_parent_idx and project_nodes_kind_idx already exist (0027).
-- The tree always loads a whole plan and orders siblings by (parent, sort_order).
CREATE INDEX IF NOT EXISTS "project_nodes_parent_sort_idx"
  ON "project_nodes" ("parent_id", "sort_order");
-- The Projects register filters to kind='project' and orders by sort_order.
CREATE INDEX IF NOT EXISTS "project_nodes_kind_sort_idx"
  ON "project_nodes" ("kind", "is_archived", "sort_order");

-- ── 6. Attachments on a CONTAINER row ─────────────────────────────────────
-- A new table, NOT the `documents` rows that back task attachments: those hang
-- off tasks.id, and a Milestone HAS NO TASK. Pointing container files at the
-- task table would mean inventing a placeholder task per milestone, which then
-- leaks into the task list and onto people's calendars as work nobody is meant
-- to do. Same shape, same bucket ("documents"), same signed-URL path — a new
-- table, not a new storage system. Executable rows keep using task attachments
-- in the detail drawer; the two never describe the same file.
CREATE TABLE IF NOT EXISTS "project_node_attachments" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id"        uuid NOT NULL REFERENCES "project_nodes"("id") ON DELETE CASCADE,
  "storage_path"   text NOT NULL,
  "file_name"      text NOT NULL,
  "mime"           text,
  "size_bytes"     integer,
  -- SET NULL, not CASCADE: an employee leaving must not delete the evidence
  -- they attached to a live milestone.
  "uploaded_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "project_node_attachments_node_idx"
  ON "project_node_attachments" ("node_id", "created_at");

-- Same RLS shape 0027 gave project_nodes: any authenticated user may read,
-- insert and delete their attachments (deleting a FILE is not the same as
-- deleting a plan row — the module archives rows and never hard-deletes them,
-- but an attachment put on the wrong milestone has to be removable).
ALTER TABLE "project_node_attachments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_node_attachments_read_authenticated"   ON "project_node_attachments";
DROP POLICY IF EXISTS "project_node_attachments_insert_authenticated" ON "project_node_attachments";
DROP POLICY IF EXISTS "project_node_attachments_delete_authenticated" ON "project_node_attachments";

CREATE POLICY "project_node_attachments_read_authenticated"
  ON "project_node_attachments" FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_node_attachments_insert_authenticated"
  ON "project_node_attachments" FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "project_node_attachments_delete_authenticated"
  ON "project_node_attachments" FOR DELETE TO authenticated USING (true);

-- project_nodes keeps 0027's `REVOKE DELETE`: the module archives and never
-- hard-deletes, so history and any task references survive. Re-asserted here
-- because it is the single most important guarantee this module rests on.
REVOKE DELETE ON "project_nodes" FROM authenticated;
REVOKE DELETE ON "project_nodes" FROM anon;
