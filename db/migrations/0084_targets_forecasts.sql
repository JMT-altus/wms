-- 0084 — Targets & Forecasts (/targets, hub module id `targets`).
--
-- Breaks the annual turnover target into quarters, months and weeks, and puts
-- Forecasted / Estimated / Actual for one customer on ONE row.
--
-- WHY ACTUALS GET THEIR OWN TABLE
-- The obvious move is to dump the Tally export into `sales_orders` and read
-- Actual from there. That would silently change everyone's pay: `sales_orders`
-- is the incentive engine's input (logSale writes it, computePeriodForEmployee
-- accrues from it), so an import would double-count against the sales reps
-- already logged by hand and inflate real money. `forecast_actuals` is shaped
-- like a sales order but is a separate, reporting-only spine. The incentive
-- module is untouched by any import here.
--
-- Money is integer paise everywhere, matching lib/incentives/types.ts. Quantity
-- is the only decimal.

-- ── Period vocabulary ───────────────────────────────────────────────────────
-- period_kind ∈ annual | quarter | month | week
-- period_key  ∈ 'FY2026' | '2026-Q1' | '2026-04' | '2026-04-06' (Monday)
-- fy_start_year is the April year: FY 2026-27 → 2026.

-- ── 1 · Top-down allocation ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecast_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fy_start_year   integer NOT NULL,
  period_kind     text    NOT NULL CHECK (period_kind IN ('annual','quarter','month','week')),
  period_key      text    NOT NULL,
  -- NULL = the company-level row for that period.
  employee_id     uuid REFERENCES employees(id) ON DELETE CASCADE,
  target_paise    bigint  NOT NULL DEFAULT 0,
  -- Still the value the cascade seeded, i.e. nobody has typed over it.
  is_derived      boolean NOT NULL DEFAULT true,
  created_by_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  updated_by_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Two partial uniques rather than one plain UNIQUE: Postgres treats NULLs as
-- distinct, so a plain constraint would happily allow ten company rows.
CREATE UNIQUE INDEX IF NOT EXISTS forecast_targets_emp_uidx
  ON forecast_targets (fy_start_year, period_kind, period_key, employee_id)
  WHERE employee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS forecast_targets_company_uidx
  ON forecast_targets (fy_start_year, period_kind, period_key)
  WHERE employee_id IS NULL;
CREATE INDEX IF NOT EXISTS forecast_targets_lookup_idx
  ON forecast_targets (fy_start_year, period_kind, employee_id);

-- ── 2 · Growth split (the 30 / 70 rule) ─────────────────────────────────────
-- Its own table, not a column on org_settings, because the split is per
-- financial year and org_settings is a single row with no FY dimension.
-- Only `existing_pct` is stored — new_pct is 100 minus it, so the two halves
-- can never disagree.
CREATE TABLE IF NOT EXISTS forecast_growth_splits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fy_start_year  integer NOT NULL,
  -- NULL = the org default for that FY; a row with an employee overrides it.
  employee_id    uuid REFERENCES employees(id) ON DELETE CASCADE,
  existing_pct   numeric(5,2) NOT NULL DEFAULT 30 CHECK (existing_pct >= 0 AND existing_pct <= 100),
  updated_by_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forecast_growth_emp_uidx
  ON forecast_growth_splits (fy_start_year, employee_id) WHERE employee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS forecast_growth_org_uidx
  ON forecast_growth_splits (fy_start_year) WHERE employee_id IS NULL;

-- ── 3 · The forecast rows ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecast_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fy_start_year      integer NOT NULL,
  period_kind        text    NOT NULL CHECK (period_kind IN ('annual','quarter','month','week')),
  period_key         text    NOT NULL,
  employee_id        uuid    NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- NULL only for the pinned "New business" row, which by definition has no
  -- named customer — that row is where the acquisition share of the target lives.
  customer_master_id uuid REFERENCES customer_masters(id) ON DELETE CASCADE,
  is_new_business    boolean NOT NULL DEFAULT false,

  quantity           numeric(14,2),
  avg_rate_paise     bigint,
  -- quantity × avg_rate when both are set, otherwise typed directly.
  forecast_paise     bigint  NOT NULL DEFAULT 0,

  estimated_paise    bigint,
  estimated_notes    text,
  estimated_at       timestamptz,
  estimated_by_id    uuid REFERENCES employees(id) ON DELETE SET NULL,

  notes              text,
  -- Provenance of a divided-down row, so a re-divide knows what it may replace.
  seeded_from_id     uuid REFERENCES forecast_lines(id) ON DELETE SET NULL,
  is_derived         boolean NOT NULL DEFAULT false,

  created_by_id      uuid REFERENCES employees(id) ON DELETE SET NULL,
  updated_by_id      uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- A row is either a named customer or the new-business bucket, never both.
  CONSTRAINT forecast_lines_customer_xor_new
    CHECK ((customer_master_id IS NOT NULL) <> is_new_business)
);
CREATE UNIQUE INDEX IF NOT EXISTS forecast_lines_customer_uidx
  ON forecast_lines (fy_start_year, period_kind, period_key, employee_id, customer_master_id)
  WHERE customer_master_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS forecast_lines_newbiz_uidx
  ON forecast_lines (fy_start_year, period_kind, period_key, employee_id)
  WHERE is_new_business;
CREATE INDEX IF NOT EXISTS forecast_lines_period_idx
  ON forecast_lines (fy_start_year, period_kind, period_key);
CREATE INDEX IF NOT EXISTS forecast_lines_owner_idx
  ON forecast_lines (employee_id, fy_start_year);

-- ── 4 · Actuals (the Tally dump) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecast_actuals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Both resolved at import; either may be NULL when a row can't be matched.
  -- Unmatched rows are REPORTED, never guessed onto a customer.
  customer_id        uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_master_id uuid REFERENCES customer_masters(id) ON DELETE SET NULL,
  employee_id        uuid REFERENCES employees(id) ON DELETE SET NULL,
  customer_name_raw  text,
  value_paise        bigint NOT NULL,
  booked_at          date   NOT NULL,
  voucher_no         text,
  product_ref        text,
  source             text   NOT NULL DEFAULT 'tally',
  import_batch_id    uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  created_by_id      uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forecast_actuals_period_idx
  ON forecast_actuals (booked_at);
CREATE INDEX IF NOT EXISTS forecast_actuals_customer_idx
  ON forecast_actuals (customer_master_id, booked_at);
CREATE INDEX IF NOT EXISTS forecast_actuals_owner_idx
  ON forecast_actuals (employee_id, booked_at);
-- Re-uploading the same Tally export must not double the actuals.
CREATE UNIQUE INDEX IF NOT EXISTS forecast_actuals_voucher_uidx
  ON forecast_actuals (voucher_no, booked_at, value_paise)
  WHERE voucher_no IS NOT NULL;

-- ── 5 · Audit ───────────────────────────────────────────────────────────────
-- Append-only, same shape as task_events / settings_events. Every number on a
-- money screen needs to be answerable for.
CREATE TABLE IF NOT EXISTS forecast_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id     uuid REFERENCES forecast_lines(id) ON DELETE CASCADE,
  target_id   uuid REFERENCES forecast_targets(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES employees(id) ON DELETE SET NULL,
  action      text NOT NULL,
  field       text,
  from_value  text,
  to_value    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forecast_events_line_idx ON forecast_events (line_id, created_at);
CREATE INDEX IF NOT EXISTS forecast_events_actor_idx ON forecast_events (actor_id, created_at);

-- ── 6 · Join customer_masters to the sales spine ────────────────────────────
-- Nullable on purpose: a master that has never traded has no `customers` row,
-- and forcing one would invent turnover history that doesn't exist.
ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS linked_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customer_masters_linked_idx
  ON customer_masters (linked_customer_id);

-- ── 7 · Cadence, as policy rather than constants ────────────────────────────
-- The routine is "monthly on the 27th, weekly before Friday logout", and a
-- period locks a few days after its deadline so nobody can retro-fit a forecast
-- to the result. All three are org policy — changing them must not need a
-- developer. Same reasoning as the training policy columns in 0080.
ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS forecast_monthly_day integer NOT NULL DEFAULT 27,
  ADD COLUMN IF NOT EXISTS forecast_weekly_dow  integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS forecast_lock_days   integer NOT NULL DEFAULT 3;

ALTER TABLE org_settings
  DROP CONSTRAINT IF EXISTS org_settings_forecast_monthly_day_check;
ALTER TABLE org_settings
  ADD CONSTRAINT org_settings_forecast_monthly_day_check
  CHECK (forecast_monthly_day BETWEEN 1 AND 28);
ALTER TABLE org_settings
  DROP CONSTRAINT IF EXISTS org_settings_forecast_weekly_dow_check;
ALTER TABLE org_settings
  ADD CONSTRAINT org_settings_forecast_weekly_dow_check
  CHECK (forecast_weekly_dow BETWEEN 1 AND 7);
