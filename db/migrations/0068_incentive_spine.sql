-- 0068 — Incentive Tracker (Sales-BH rebuild): commercial spine, activity,
-- rule spine and append-only ledger. See docs/incentive-tracker/PLAN.md and
-- lib/incentives/. Money is integer paise (bigint). Additive + idempotent.

-- ── Commercial spine ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  code                    text,
  acquisition_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  first_transaction_at    timestamptz,
  fy_turnover_paise       bigint NOT NULL DEFAULT 0,
  is_new_customer         boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_code_idx ON customers(code);
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name);

CREATE TABLE IF NOT EXISTS sales_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  owner_id          uuid REFERENCES employees(id) ON DELETE SET NULL,
  order_value_paise bigint NOT NULL,
  category_code     text NOT NULL,
  product_ref       text,
  brand_ref         text,
  booked_at         timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_orders_customer_idx ON sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS sales_orders_owner_idx ON sales_orders(owner_id);
CREATE INDEX IF NOT EXISTS sales_orders_booked_idx ON sales_orders(booked_at);

CREATE TABLE IF NOT EXISTS invoices (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                      uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  invoice_no                    text,
  invoice_value_paise           bigint NOT NULL,
  invoice_date                  date NOT NULL,
  agreed_terms_days             integer NOT NULL DEFAULT 0,
  due_date                      date,
  is_first_invoice_for_customer boolean NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_order_idx ON invoices(order_id);
CREATE INDEX IF NOT EXISTS invoices_date_idx ON invoices(invoice_date);

CREATE TABLE IF NOT EXISTS receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_paise bigint NOT NULL,
  received_at  date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_invoice_idx ON receipts(invoice_id);

-- ── Activity spine ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_month   text NOT NULL,
  lead_count     integer NOT NULL DEFAULT 0,
  profiled       boolean NOT NULL DEFAULT false,
  evidence_url   text,
  review_status  text NOT NULL DEFAULT 'pending',
  reviewed_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_batches_emp_period_idx ON lead_batches(employee_id, period_month);

CREATE TABLE IF NOT EXISTS lead_conversions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  lead_batch_id   uuid REFERENCES lead_batches(id) ON DELETE SET NULL,
  period_month    text NOT NULL,
  converted_count integer NOT NULL DEFAULT 0,
  review_status   text NOT NULL DEFAULT 'pending',
  reviewed_by_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_conversions_emp_period_idx ON lead_conversions(employee_id, period_month);

CREATE TABLE IF NOT EXISTS client_meetings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,
  period_month   text NOT NULL,
  potential_band text,
  awarded_paise  bigint NOT NULL DEFAULT 0,
  justification  text,
  review_status  text NOT NULL DEFAULT 'pending',
  reviewed_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_meetings_emp_period_idx ON client_meetings(employee_id, period_month);

CREATE TABLE IF NOT EXISTS testimonials (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id            uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  customer_id            uuid REFERENCES customers(id) ON DELETE SET NULL,
  period_month           text NOT NULL,
  kind                   text NOT NULL,
  word_count             integer NOT NULL DEFAULT 0,
  star_rating            integer,
  names_team_member      boolean NOT NULL DEFAULT false,
  mentioned_employee_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_url           text,
  review_status          text NOT NULL DEFAULT 'pending',
  reviewed_by_id         uuid REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at            timestamptz,
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS testimonials_emp_period_idx ON testimonials(employee_id, period_month);

-- ── Rule spine ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentive_schemes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  scope_role     text,
  effective_from date,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rule_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id       uuid NOT NULL REFERENCES incentive_schemes(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  config          jsonb NOT NULL,
  effective_from  date,
  effective_to    date,
  published_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rule_versions_scheme_version_idx ON rule_versions(scheme_id, version);

CREATE TABLE IF NOT EXISTS scheme_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  scheme_id      uuid NOT NULL REFERENCES incentive_schemes(id) ON DELETE CASCADE,
  effective_from date,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheme_assignments_employee_idx ON scheme_assignments(employee_id);

-- ── Ledger spine ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentive_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month        text NOT NULL,
  status       text NOT NULL DEFAULT 'open',
  locked_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS incentive_periods_month_idx ON incentive_periods(month);

CREATE TABLE IF NOT EXISTS incentive_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_id         uuid NOT NULL REFERENCES incentive_periods(id) ON DELETE CASCADE,
  rule_line_code    text NOT NULL,
  category          text NOT NULL,
  rule_version_id   uuid REFERENCES rule_versions(id) ON DELETE SET NULL,
  entry_type        text NOT NULL,
  amount_paise      bigint NOT NULL,
  source_event_type text,
  source_event_id   text,
  source_ref        text,
  explanation       text,
  computed_at       timestamptz,
  created_by_id     uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incentive_ledger_emp_period_idx ON incentive_ledger(employee_id, period_id);
CREATE INDEX IF NOT EXISTS incentive_ledger_period_idx ON incentive_ledger(period_id);
CREATE UNIQUE INDEX IF NOT EXISTS incentive_ledger_idem_idx
  ON incentive_ledger(period_id, employee_id, rule_line_code, source_ref, entry_type);

CREATE TABLE IF NOT EXISTS payout_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id            uuid NOT NULL REFERENCES incentive_periods(id) ON DELETE CASCADE,
  total_paise          bigint NOT NULL DEFAULT 0,
  export_ref           text,
  pushed_to_payroll_at timestamptz,
  created_by_id        uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payout_runs_period_idx ON payout_runs(period_id);

CREATE TABLE IF NOT EXISTS incentive_disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id   uuid NOT NULL REFERENCES incentive_ledger(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  message     text NOT NULL,
  status      text NOT NULL DEFAULT 'open',
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incentive_disputes_ledger_idx ON incentive_disputes(ledger_id);
