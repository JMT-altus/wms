-- 0108 — Apply-for-Leave workflow on top of the existing leave_requests.
--
-- The Leave page already stores requests in `leave_requests` (paid/unpaid kind,
-- pending/approved/rejected/cancelled, decided_by/decided_at/decision_note). This
-- extends that table instead of adding a second one:
--
--   * leave_type  — Emergency | Planned, as asked for on the new form.
--   * approver_id — who the request was routed to when it was filed.
--   * kind        — becomes NULLABLE. Paid/unpaid is a PAY decision that belongs
--                   to the (not yet approved) leave policy, not to the employee,
--                   so a request filed on the new form carries none. Nothing
--                   treats a NULL kind as paid: the balance maths only counts
--                   kind = 'paid', so such a request consumes no allowance.
--
-- `leave_approvers` is the permission side: who may decide leave, and which one
-- is the default a new request is routed to. Managed by admins in the app; no
-- person or e-mail address is hard-coded in the code.
--
-- Additive and safe to re-run.

ALTER TABLE "leave_requests" ALTER COLUMN "kind" DROP NOT NULL;
ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "leave_type" text;
ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "approver_id" uuid
  REFERENCES "employees"("id") ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE "leave_requests"
    ADD CONSTRAINT "leave_requests_leave_type_check"
    CHECK ("leave_type" IS NULL OR "leave_type" IN ('emergency','planned'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "leave_requests_approver_status_idx"
  ON "leave_requests" ("approver_id", "status");

-- One pending request per employee per date range: a double click or a retry
-- cannot file the same leave twice.
CREATE UNIQUE INDEX IF NOT EXISTS "leave_requests_pending_dup_idx"
  ON "leave_requests" ("employee_id", "start_date", "end_date")
  WHERE "status" = 'pending';

CREATE TABLE IF NOT EXISTS "leave_approvers" (
  "employee_id" uuid PRIMARY KEY REFERENCES "employees"("id") ON DELETE CASCADE,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- At most one default.
CREATE UNIQUE INDEX IF NOT EXISTS "leave_approvers_one_default_idx"
  ON "leave_approvers" ((true)) WHERE "is_default";

-- Seed the default from the real account, if exactly one active "Mihir Veera"
-- exists. If there is none (or the name is ambiguous) nothing is seeded and an
-- admin picks the approver in the app — the migration never guesses.
INSERT INTO "leave_approvers" ("employee_id", "is_default")
SELECT e."id", true
FROM "employees" e
WHERE lower(trim(e."name")) = 'mihir veera'
  AND e."is_active"
  AND (SELECT count(*) FROM "employees" x
       WHERE lower(trim(x."name")) = 'mihir veera' AND x."is_active") = 1
ON CONFLICT DO NOTHING;
