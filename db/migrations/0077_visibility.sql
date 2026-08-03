-- 0077 — row-level visibility for tasks and projects.
--
-- Until now there was NO row-level visibility anywhere: every signed-in user
-- could see every task and every project. This introduces the concept.
--
--   private     only the people ON the row (doer / initiator / creator, plus
--               project members) and the super-admins. The personal space.
--   internal    everyone. The existing behaviour, and the default, so nothing
--               changes for anyone until they opt in.
--   restricted  the people on the row, the super-admins, and whoever the
--               matching *_audience rows name.
--
-- Why a column AND an audience table rather than one or the other: "visible to
-- some departments but not others" is a SET, which needs rows; but joining an
-- audience table on every task query would tax the ~95% of rows that are just
-- 'internal'. The column keeps the hot path a single indexed comparison and the
-- join only happens for rows explicitly marked 'restricted'.

-- ── Tasks ────────────────────────────────────────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'internal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_visibility_ck'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_visibility_ck
      CHECK (visibility IN ('private', 'internal', 'restricted'));
  END IF;
END $$;

-- Partial: only 'restricted' rows ever need the audience join, and only
-- non-'internal' rows narrow the common query.
CREATE INDEX IF NOT EXISTS tasks_visibility_idx
  ON tasks (visibility) WHERE visibility <> 'internal';

-- ── Projects ─────────────────────────────────────────────────────────────
-- Set on the ROOT project only and inherited by every descendant. Per-node
-- visibility would allow a public milestone under a private project and would
-- make every read walk ancestors.
ALTER TABLE project_nodes
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'internal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_nodes_visibility_ck'
  ) THEN
    ALTER TABLE project_nodes ADD CONSTRAINT project_nodes_visibility_ck
      CHECK (visibility IN ('private', 'internal', 'restricted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_nodes_visibility_idx
  ON project_nodes (visibility) WHERE visibility <> 'internal';

-- ── Audiences ────────────────────────────────────────────────────────────
-- kind = 'department' → ref_id is a departments.id
--        'employee'   → ref_id is an employees.id
--        'management' → ref_id IS NULL, means "anyone holding a designation
--                       flagged is_management". Kept as a kind rather than a
--                       magic department so renaming a designation can never
--                       silently change who can see something.
CREATE TABLE IF NOT EXISTS task_audience (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind    text NOT NULL,
  ref_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_audience_kind_ck CHECK (
    (kind = 'management' AND ref_id IS NULL)
    OR (kind IN ('department', 'employee') AND ref_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS task_audience_uq
  ON task_audience (task_id, kind, ref_id) WHERE ref_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS task_audience_mgmt_uq
  ON task_audience (task_id) WHERE kind = 'management';
CREATE INDEX IF NOT EXISTS task_audience_lookup_idx
  ON task_audience (kind, ref_id);

CREATE TABLE IF NOT EXISTS project_audience (
  project_node_id uuid NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  kind    text NOT NULL,
  ref_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_audience_kind_ck CHECK (
    (kind = 'management' AND ref_id IS NULL)
    OR (kind IN ('department', 'employee') AND ref_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS project_audience_uq
  ON project_audience (project_node_id, kind, ref_id) WHERE ref_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_audience_mgmt_uq
  ON project_audience (project_node_id) WHERE kind = 'management';
CREATE INDEX IF NOT EXISTS project_audience_lookup_idx
  ON project_audience (kind, ref_id);

-- ── "Management" ─────────────────────────────────────────────────────────
-- An explicit flag on the designation, NOT a name match. Designation names are
-- free text an admin can rename from /admin/designations; keying permissions
-- off the string would silently change who can see things on a rename.
ALTER TABLE designations
  ADD COLUMN IF NOT EXISTS is_management boolean NOT NULL DEFAULT false;

-- Best-effort seed of the obvious ones. Admins maintain it from here.
UPDATE designations
   SET is_management = true
 WHERE is_management = false
   AND lower(name) ~ '(^|[^a-z])(md|managing director|manager|head|lead|director|executive|founder|ceo|coo|cto)([^a-z]|$)';

CREATE INDEX IF NOT EXISTS designations_management_idx
  ON designations (is_management) WHERE is_management = true;
