-- 0102 — Tasks module: two-stage approval, time tracking, checklists,
--        the recycle bin, and the two missing hot-path indexes.
--
-- Five independent additions, one migration because they all land on the
-- tasks spine and share a single re-apply. Nothing here rewrites existing
-- behaviour: every column is nullable or defaulted, every table is new, and
-- the existing single-stage approval columns (approved_by_id / approved_at /
-- approval_note) stay exactly where they are and keep being written.
--
-- Written defensively (create-if-not-exists) like every migration from 0023+,
-- so apply-all-migrations.ts can re-run it against a populated database.

-- ── 1. Two-stage approval ─────────────────────────────────────────────────
-- `approval_status` is the manager's VERDICT ("is this work acceptable?").
-- `approval_level` is how far that verdict has travelled through sign-off:
--
--   none  → nobody has ruled yet
--   manager → the doer's manager accepted it
--   admin   → final sign-off, which ONLY a founder (super-admin) can give
--
-- They are deliberately separate columns from `status` (the doer's progress
-- report). Three axes, never collapsed — see db/enums.ts.
--
-- CREATE TYPE has no IF NOT EXISTS, so guard it in a DO block; this is a new
-- type rather than an ALTER, so it is transaction-safe (unlike 0024's
-- `alter type ... add value`, which the applier has to run standalone).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_level') THEN
    CREATE TYPE approval_level AS ENUM ('none', 'manager', 'admin');
  END IF;
END
$$;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS approval_level approval_level NOT NULL DEFAULT 'none';

-- Manager stage. Distinct from the legacy approved_* trio, which stays as the
-- record of "who pressed Approve" regardless of stage.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS manager_approved_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_at    timestamptz,
  ADD COLUMN IF NOT EXISTS manager_approval_note  text;

-- Admin (founder) stage — final sign-off.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS admin_approved_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_approved_at    timestamptz,
  ADD COLUMN IF NOT EXISTS admin_approval_note  text;

CREATE INDEX IF NOT EXISTS tasks_approval_level_idx ON tasks (approval_level);

-- Backfill: rows that already carry a verdict were approved under the
-- single-stage flow, which is exactly what 'manager' means. Without this every
-- historically-approved task would read as "awaiting the manager" forever.
-- Guarded on approval_level='none' so a re-run never demotes an admin stage.
UPDATE tasks
SET approval_level        = 'manager',
    manager_approved_by_id = approved_by_id,
    manager_approved_at    = approved_at,
    manager_approval_note  = approval_note
WHERE approval_status IS NOT NULL
  AND approval_level = 'none'
  AND approved_at IS NOT NULL;

-- ── 2. Estimated effort ───────────────────────────────────────────────────
-- The planned side of the Estimated-vs-Actual panel. Actual comes from the
-- time-tracking tables below.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS estimated_minutes integer;

-- ── 3. Recycle bin ────────────────────────────────────────────────────────
-- Archive is the normal end of life and stays untouched. Abandoning is the
-- softer alternative to DELETE: the row survives (history has to survive) but
-- drops out of every list until it is restored or purged.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS abandoned_at    timestamptz,
  ADD COLUMN IF NOT EXISTS abandoned_by_id uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Partial: abandoned rows are a rounding error next to the live table, and
-- "still live" is never what the recycle bin wants.
CREATE INDEX IF NOT EXISTS tasks_abandoned_at_idx
  ON tasks (abandoned_at) WHERE abandoned_at IS NOT NULL;

-- ── 4. Goal provenance ────────────────────────────────────────────────────
-- Set when a task was spawned out of a weekly goal. Intentionally NOT a
-- foreign key: goals get hard-deleted on re-planning and losing the task with
-- them would be wrong, so this is a soft pointer the reader resolves (or
-- doesn't).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS origin_goal_id uuid;

CREATE INDEX IF NOT EXISTS tasks_origin_goal_idx
  ON tasks (origin_goal_id) WHERE origin_goal_id IS NOT NULL;

-- ── 5. The two missing hot-path indexes ───────────────────────────────────
-- "this person's open work" — the single most-run query in the module (every
-- My Day, every doer filter, every nav count).
CREATE INDEX IF NOT EXISTS tasks_doer_status_idx ON tasks (doer_id, status);

-- Partial: "still open" is most of the table and never what a completion
-- query wants.
CREATE INDEX IF NOT EXISTS tasks_completed_at_idx
  ON tasks (completed_at) WHERE completed_at IS NOT NULL;

-- ── 6. Checklist items ────────────────────────────────────────────────────
-- Sub-steps inside one task. Deliberately NOT sub-tasks: they carry no doer,
-- no due date and no status lifecycle, because the moment a step needs its own
-- owner it is a task and belongs in `tasks`.
CREATE TABLE IF NOT EXISTS task_checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content     text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  -- Who ticked it and when. Both null while the item is open; cleared again
  -- when it is un-ticked, so the pair never describes a stale person.
  done_by_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  done_at     timestamptz,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Covers the only read there is: "every item on this task, in order".
CREATE INDEX IF NOT EXISTS task_checklist_task_order_idx
  ON task_checklist_items (task_id, sort_order);

-- ── 7. Time tracking ──────────────────────────────────────────────────────
-- Three tables on purpose, because they answer three different questions.
--
--   task_time_events  — the RAW append-only log of start/stop presses. Never
--                       updated, never deleted; this is the evidence.
--   task_work_sessions — RESOLVED spans (started → ended, with a duration).
--                       Derived from the events, but stored, because pairing
--                       events back into spans on every read is both slow and
--                       ambiguous when a stop went missing.
--   task_time_rollup   — one cached total PER TASK. Exists so a list of 500
--                       rows does not aggregate raw events 500 times.
--
-- The rollup is a cache, not a source of truth: it can always be rebuilt from
-- task_work_sessions, and lib/tasks/time.ts is the only writer.

CREATE TABLE IF NOT EXISTS task_time_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- 'start' | 'stop'. Free text rather than an enum so adding 'pause' later
  -- doesn't need an ALTER TYPE outside a transaction.
  kind        text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  source      text,                    -- 'web' | 'mobile' | 'auto'
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- "the latest press by this person on this task" — the open-timer lookup that
-- runs on every timer button render.
CREATE INDEX IF NOT EXISTS task_time_events_task_emp_at_idx
  ON task_time_events (task_id, employee_id, at DESC);
CREATE INDEX IF NOT EXISTS task_time_events_emp_at_idx
  ON task_time_events (employee_id, at DESC);

CREATE TABLE IF NOT EXISTS task_work_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL,
  -- NULL while the timer is still running. At most one such row per
  -- (task, employee) — enforced by the partial unique index below.
  ended_at     timestamptz,
  -- Denormalised duration, written when the session closes. Stored rather
  -- than computed so the rollup is a plain SUM and reports never re-derive
  -- it per row.
  duration_seconds integer,
  -- True when a stop was never pressed and the reconciler closed the session
  -- for us. Surfaced in reports so an 11-hour "session" reads as a forgotten
  -- timer rather than a heroic day.
  auto_closed  boolean NOT NULL DEFAULT false,
  source       text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One person can have at most ONE running timer on a given task. Partial, so
-- it constrains only open sessions and closed history stays unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS task_work_sessions_open_uq
  ON task_work_sessions (task_id, employee_id) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS task_work_sessions_task_idx
  ON task_work_sessions (task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS task_work_sessions_emp_started_idx
  ON task_work_sessions (employee_id, started_at DESC);
-- Backs the "who has a timer running right now" manager view.
CREATE INDEX IF NOT EXISTS task_work_sessions_open_idx
  ON task_work_sessions (employee_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS task_time_rollup (
  task_id        uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  total_seconds  integer NOT NULL DEFAULT 0,
  session_count  integer NOT NULL DEFAULT 0,
  first_started_at timestamptz,
  last_ended_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
