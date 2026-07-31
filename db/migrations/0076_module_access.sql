-- 0076 — per-module access control.
--
-- One row = one explicit grant of a hub module to a subject.  Three subject
-- levels, resolved most-specific-first at read time:
--
--   employee   → this one person
--   department → everyone in that department (an allow beats a deny)
--   everyone   → the org-wide default for non-admin staff
--
-- No row at a level = "inherit"; falling through every level lands on the
-- code default in lib/access/modules.ts.  Admins bypass the `everyone` layer
-- (so an org-wide deny never locks the admin panel's owners out of a module);
-- super-admins bypass the whole thing.

CREATE TABLE IF NOT EXISTS module_access_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id    text NOT NULL,
  subject_type text NOT NULL,
  subject_id   uuid,
  allowed      boolean NOT NULL,
  updated_by   uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_access_grants_subject_ck CHECK (
    (subject_type = 'everyone' AND subject_id IS NULL)
    OR (subject_type IN ('department', 'employee') AND subject_id IS NOT NULL)
  )
);

-- Two partial uniques rather than one composite, because `subject_id` is NULL
-- for the org-wide rows and NULLs never collide in a plain unique index.
CREATE UNIQUE INDEX IF NOT EXISTS module_access_grants_everyone_uq
  ON module_access_grants (module_id)
  WHERE subject_type = 'everyone';

CREATE UNIQUE INDEX IF NOT EXISTS module_access_grants_subject_uq
  ON module_access_grants (module_id, subject_type, subject_id)
  WHERE subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS module_access_grants_subject_idx
  ON module_access_grants (subject_type, subject_id);

-- Seed the org-wide defaults: staff get WMS + Training; Employees (attendance,
-- salary, leave) and the Incentive Tracker start closed and are opened per
-- person or per department from /admin/access.
INSERT INTO module_access_grants (module_id, subject_type, subject_id, allowed)
VALUES
  ('wms',       'everyone', NULL, true),
  ('training',  'everyone', NULL, true),
  ('employees', 'everyone', NULL, false),
  ('sales',     'everyone', NULL, false)
ON CONFLICT DO NOTHING;
