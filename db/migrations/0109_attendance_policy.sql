-- 0109 — Configurable attendance policy, with its audit history.
--
-- Every attendance/payroll rule (working-day method, weekly offs, leave pay,
-- Sunday work, COM OFF, optional-holiday pay, punch rules ...) is defined in
-- code (lib/attendance/policy.ts) with an initial value. This table holds the
-- CHANGES made to those values, append-only:
--
--   * a setting's value on a date is the latest change whose effective_from has
--     arrived, so a later change never alters an earlier month;
--   * previous_value / changed_by / reason / created_at are the audit trail —
--     rows are never updated or deleted by the application.
--
-- Holiday dates are NOT here: they stay in the existing `holidays` table, the one
-- source of truth. Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "attendance_policy_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "policy_key" text NOT NULL,
  "value" jsonb NOT NULL,
  "previous_value" jsonb,
  "effective_from" date NOT NULL,
  "reason" text NOT NULL,
  "changed_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "attendance_policy_changes_key_idx"
  ON "attendance_policy_changes" ("policy_key", "effective_from" DESC, "created_at" DESC);
