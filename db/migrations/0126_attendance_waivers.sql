-- 0126 Attendance waivers — HR → Attendance Correction → Waive attendance.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0000 (employees). Independent of
-- every other pending file. Never apply through `pnpm db:migrate`; apply this
-- one file with the role the app connects as (DATABASE_URL), through the
-- hash-pinned apply script, then record it in __schema_applied.
--
-- One row per WAIVER EPISODE: an authorised HR user waived one employee's
-- attendance for one date, with a mandatory reason; if someone later reversed
-- it, who did so, when, and why (mandatory). Reversing never deletes: the
-- episode keeps its row, and waiving the day again starts a NEW row, so every
-- change stays on record (the episode shape of collection_company_marks, 0125).
--
-- Treatment (approved): an active waiver makes that working day "WV — Waived":
-- one payable day (like paid leave), not absent / half-day / no check-out, and
-- its late or early mark does not count toward the every-3rd-late deduction.
-- The punches are NOT touched and no hours are invented — the day still shows
-- the times that were recorded. Holidays, weekly offs, leave and comp-off days
-- keep their own grade (a waiver on such a day has no effect).
--
-- No existing table or row is touched. A salary run already generated for the
-- month is never changed: its stale check shows "needs review" (existing rule).
--
-- No direct REST access: RLS on with no policies, REST roles revoked (pattern of
-- 0114 … 0125). Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "attendance_waivers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "log_date" date NOT NULL,
  "reason" text NOT NULL,
  -- Who waived it and when. The person may later be removed; the episode stays.
  "waived_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "waived_at" timestamptz NOT NULL DEFAULT now(),
  -- Who reversed it, when and why. NULL = the waiver is active.
  "reversed_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "reversed_at" timestamptz,
  "reverse_reason" text,
  CONSTRAINT "attendance_waivers_reason_check" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "attendance_waivers_reversal_check" CHECK (
    ("reversed_at" IS NULL AND "reverse_reason" IS NULL AND "reversed_by_id" IS NULL)
    OR ("reversed_at" IS NOT NULL AND "reversed_at" >= "waived_at" AND length(btrim(coalesce("reverse_reason", ''))) >= 3)
  )
);

-- At most ONE active waiver per employee and date: a repeated or concurrent
-- waiver is refused by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_waivers_one_active_uq"
  ON "attendance_waivers" ("employee_id", "log_date") WHERE "reversed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "attendance_waivers_employee_date_idx"
  ON "attendance_waivers" ("employee_id", "log_date");

ALTER TABLE "attendance_waivers" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.attendance_waivers FROM %I', r);
    END IF;
  END LOOP;
END
$$;
