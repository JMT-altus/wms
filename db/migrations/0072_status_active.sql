-- 0072 — status hide/show. An inactive status stays valid for existing tasks
-- but is removed from the status pickers ("delete" without dropping the enum
-- value or orphaning tasks). Additive + idempotent.

ALTER TABLE status_settings ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
