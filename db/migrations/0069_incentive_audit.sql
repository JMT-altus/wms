-- 0069 — Incentive audit trail. Append-only record of every incentive action
-- (who logged/edited/collected/approved, when) powering the deal, customer and
-- rep timelines. Additive + idempotent.

CREATE TABLE IF NOT EXISTS incentive_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES employees(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incentive_audit_entity_idx ON incentive_audit(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS incentive_audit_employee_idx ON incentive_audit(employee_id, created_at);
