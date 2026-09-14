-- 0105 — Credit Limit history.
--
-- `customer_masters.credit_limit` holds the CURRENT figure and nothing else,
-- so "whose limit went up this month, and by how much" was not a question the
-- database could answer — the previous value was overwritten by whoever
-- changed it. A limit is a commercial decision, and the decision is worth as
-- much as the number.
--
-- One row per change, written by the actions that change the column. Not a
-- trigger: the app knows WHO made the change and a trigger does not, and an
-- audit row with no author answers half the question.
CREATE TABLE IF NOT EXISTS customer_credit_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer_masters(id) ON DELETE CASCADE,
  -- Both nullable: a limit can be set for the first time (no previous) or
  -- cleared entirely (no new). numeric, matching the column it tracks.
  previous_limit numeric(14, 2),
  new_limit numeric(14, 2),
  changed_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The section reads newest-first across all clients, and per client when you
-- open one, so both are indexed.
CREATE INDEX IF NOT EXISTS customer_credit_limit_events_created_idx
  ON customer_credit_limit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS customer_credit_limit_events_customer_idx
  ON customer_credit_limit_events (customer_id, created_at DESC);
