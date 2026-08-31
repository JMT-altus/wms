-- 0091 — Auto-archive approved tasks after N days.
--
-- One configurable setting on the single-row org_settings table. 0 means the
-- sweep never runs, and that is the default on purpose: switching this on
-- archives every already-approved task older than the window in one go, which
-- must be a deliberate choice by an admin rather than something a migration
-- does to a live board.
--
-- No new column on `tasks` is needed. `approved_at` (M2.1) already records when
-- the verdict was given and `archived` already exists, so the sweep is a plain
-- UPDATE over two columns this table has carried for a long time.

ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS auto_archive_approved_days integer NOT NULL DEFAULT 0;

-- Narrows the sweep to rows still eligible. Deliberately covers BOTH approval
-- paths: approveTask() writes tasks.status = 'approved' + approved_at, while
-- setTaskApprovalStatus() writes tasks.approval_status = 'approved' and no
-- timestamp at all. An index on approval_status alone would miss every task
-- approved through the normal Approve button.
DROP INDEX IF EXISTS tasks_auto_archive_idx;
CREATE INDEX IF NOT EXISTS tasks_auto_archive_idx
  ON tasks (approved_at)
  WHERE archived = false
    AND (approval_status = 'approved' OR status = 'approved');
