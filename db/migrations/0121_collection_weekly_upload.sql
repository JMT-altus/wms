-- 0121 Collection Tracker weekly Bulk Upload — the compulsory weekly task.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0000 (employees, tasks) and 0117
-- (collection_balance_snapshots). Do not run anywhere shared until reviewed.
-- Never apply through `pnpm db:migrate` (it would also apply every other pending
-- file); apply this one file, with the role the app connects as (DATABASE_URL).
--
-- The Tally customer summary must be uploaded through the Collection Tracker's
-- Bulk Upload every week. WMS creates one task per reporting week (Monday to
-- Sunday, IST) for the employee an administrator chose in Admin & Master Setup,
-- reminds them through the existing notification inbox, and marks the task
-- done only when a Bulk Upload is actually confirmed and written.
--
-- Two small tables. The task itself is an ordinary row in `tasks` (so the
-- Tasks module, the inbox, the reminder cron and the audit timeline all apply
-- unchanged); these tables only say WHICH task is the week's compulsory one.
--
--   collection_weekly_upload_settings  one row (id = 1): the responsible
--                                      employee and the due weekday. Starts
--                                      EMPTY — nothing is assigned by code.
--   collection_weekly_upload_tasks     one row per reporting week, keyed by the
--                                      week's Monday (the stable week id), so a
--                                      retried or doubled scheduler run can
--                                      never create a second task for a week.
--                                      Holds the completion reference (which
--                                      snapshot completed it, by whom, when) and
--                                      the timestamps of each reminder sent, so
--                                      reminders are idempotent and auditable.
--
-- task_id is ON DELETE RESTRICT: the compulsory task cannot be deleted while
-- the week row exists (the application refuses as well). Deleting the
-- snapshot or an employee only blanks the reference.
--
-- No direct REST access: RLS on with no policies, and the Supabase REST roles
-- (`anon`, `authenticated`) have no privileges — the app reads and writes only
-- from the server. Skipped cleanly where those roles don't exist (same pattern
-- as 0114 / 0115 / 0117 / 0119 / 0120). Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "collection_weekly_upload_settings" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "assignee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  -- ISO weekday the upload is due, 1 = Monday … 7 = Sunday. Default Friday.
  "due_dow" integer NOT NULL DEFAULT 5,
  "set_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_weekly_upload_settings_single_row" CHECK ("id" = 1),
  CONSTRAINT "collection_weekly_upload_settings_due_dow_check" CHECK ("due_dow" BETWEEN 1 AND 7)
);

CREATE TABLE IF NOT EXISTS "collection_weekly_upload_tasks" (
  -- The reporting week's Monday (IST). One task per week, ever.
  "week_start" date PRIMARY KEY,
  "task_id" uuid NOT NULL UNIQUE REFERENCES "tasks"("id") ON DELETE RESTRICT,
  -- Who it was created for (kept for history; the live assignee is the task's doer).
  "assignee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "due_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- Set once, by the confirmed Bulk Upload that completed the week (or the
  -- reconciling sweep that found it). NULL = still open.
  "completed_at" timestamptz,
  "completed_snapshot_id" uuid REFERENCES "collection_balance_snapshots"("id") ON DELETE SET NULL,
  "completed_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  -- When each notification was sent. Each is claimed with a conditional
  -- UPDATE … WHERE … IS NULL, so a retried run sends nothing twice.
  "notified_assigned_at" timestamptz,
  "notified_due_today_at" timestamptz,
  "notified_overdue_at" timestamptz,
  "notified_completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "collection_weekly_upload_tasks_open_idx"
  ON "collection_weekly_upload_tasks" ("due_at")
  WHERE "completed_at" IS NULL;

ALTER TABLE "collection_weekly_upload_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection_weekly_upload_tasks" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collection_weekly_upload_settings', 'collection_weekly_upload_tasks'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
