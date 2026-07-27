-- 0070 — Sales confirmation. A rep logs their own deals, but they must be
-- confirmed by an admin before they count toward incentive (trust/anti-gaming).
-- Default TRUE so all existing rows (and admin-entered sales) keep counting;
-- rep-logged sales are inserted as FALSE. Additive + idempotent.

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS confirmed       boolean NOT NULL DEFAULT true;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS confirmed_by_id uuid REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS confirmed_at    timestamptz;
CREATE INDEX IF NOT EXISTS sales_orders_confirmed_idx ON sales_orders(confirmed);
