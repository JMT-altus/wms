-- 0125 Collection company marks — MARK AS PRIORITY and COLLECTION DONE in the Tracker.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0000 (employees) and 0112
-- (collection_master_companies). Independent of 0113–0124.
-- Never apply through `pnpm db:migrate` (it would also apply every other pending
-- file); apply this one file, with the role the app connects as (DATABASE_URL).
--
-- One row per MARK EPISODE of a Collection Master company: a person marked the
-- company as a priority (kind 'priority') or its collection as done (kind
-- 'done'), and — if someone later reversed it — who did so and when. Reversing
-- never deletes: the episode keeps its row, and marking the company again starts
-- a NEW row, so every change stays on record with who made it and when (the
-- same episode shape as collection_closures, 0119).
--
-- The CURRENT state of a company is its episodes with no cleared_at: an active
-- 'priority' row puts it at the top of the Tracker (yellow); an active 'done'
-- row puts it at the bottom (faded). A company may hold both; the Tracker then
-- treats it as done. A mark is a person's decision only: nothing here is written
-- or cleared by a Collection Master import, a Bulk Upload of balances, a
-- closure (Collection Logs), or any balance figure, and marking a company done
-- does not move it to Collection Logs or change any other record.
--
-- Rows reference the Collection Master by id (ON DELETE RESTRICT), which a
-- Master re-import updates in place and never deletes, so marks survive every
-- import. No company, follow-up, commitment, confirmation, escalation or
-- closure is created, changed or removed here.
--
-- No direct REST access: RLS on with no policies, and the Supabase REST roles
-- (`anon`, `authenticated`) have no privileges — the app reads and writes only
-- from the server. Skipped cleanly where those roles don't exist (same pattern
-- as 0114 / 0115 / 0117 / 0119 / 0123).
--
-- Additive and safe to re-run (IF NOT EXISTS / existence checks). No existing
-- table or row is touched.

CREATE TABLE IF NOT EXISTS "collection_company_marks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "collection_master_companies"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL,
  -- Who marked it and when. The person may later be removed; the episode stays.
  "set_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "set_at" timestamptz NOT NULL DEFAULT now(),
  -- Who reversed it and when. NULL = the mark is still active.
  "cleared_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "cleared_at" timestamptz,
  CONSTRAINT "collection_company_marks_kind_check" CHECK ("kind" IN ('priority', 'done')),
  CONSTRAINT "collection_company_marks_cleared_check" CHECK ("cleared_at" IS NULL OR "cleared_at" >= "set_at")
);

-- At most ONE active mark of each kind per company: a repeated or concurrent
-- "mark as priority" / "collection done" is refused by the database itself,
-- so a double click can never create two episodes.
CREATE UNIQUE INDEX IF NOT EXISTS "collection_company_marks_one_active_uq"
  ON "collection_company_marks" ("company_id", "kind") WHERE "cleared_at" IS NULL;

CREATE INDEX IF NOT EXISTS "collection_company_marks_company_idx"
  ON "collection_company_marks" ("company_id", "set_at" DESC);

ALTER TABLE "collection_company_marks" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.collection_company_marks FROM %I', r);
    END IF;
  END LOOP;
END
$$;
