-- 0081 — Phase 1: Admin & Master Data Setup.
--
-- Five modules, one migration:
--   1. Product hierarchy   Category → Product → SKU
--   2. Customer masters    profile + behavioural classification
--   3. System libraries    editable dropdowns + incentive slabs
--   4. Field permissions   the field-level layer ON TOP of module_access_grants
--   5. Data ingestion      import batches + Tally group mapping
--
-- Design notes that matter later:
--
--  • Everything admins classify (volume class, purchase pattern, sensitivity,
--    flange type) is `text` + CHECK, not a pgEnum — adding a value to a Postgres
--    enum needs ALTER TYPE outside a transaction, which this repo's migration
--    runner has to special-case (see 0024). Text + CHECK edits in place.
--
--  • Sub-classifications are NULLABLE by design. Module 5 explicitly requires
--    that old Tally/Sheets records import with unmapped fields left blank
--    rather than failing validation, so nothing below is NOT NULL unless the
--    row is meaningless without it.

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · PRODUCT HIERARCHY
-- ════════════════════════════════════════════════════════════════════════════

-- Self-referential so "Three-Phase Motor → 5 HP" is a parent/child pair rather
-- than two unrelated rows. Depth is not constrained; the UI renders a tree.
CREATE TABLE IF NOT EXISTS product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text,
  parent_id   uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_categories_parent_idx ON product_categories (parent_id);
CREATE INDEX IF NOT EXISTS product_categories_active_idx ON product_categories (is_active, sort_order, name);
CREATE UNIQUE INDEX IF NOT EXISTS product_categories_code_uq ON product_categories (lower(code)) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  name        text NOT NULL,
  code        text,
  brand       text,
  description text,
  -- The named attributes from the brief. All optional: a pump has no flange.
  hp            numeric(10,2),
  power_rating  text,
  flange_type   text,
  kvh           text,
  -- Anything else an admin wants to record without a schema change.
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Tally product-master sync: the name as it appears in a Tally export.
  tally_name  text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_flange_ck CHECK (
    flange_type IS NULL OR flange_type IN ('with_flange','without_flange','not_applicable')
  )
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);
CREATE INDEX IF NOT EXISTS products_active_name_idx ON products (is_active, name);
CREATE UNIQUE INDEX IF NOT EXISTS products_code_uq ON products (lower(code)) WHERE code IS NOT NULL;

-- The sellable unit. sku_code is globally unique and case-insensitive — the
-- same code in two cases is a data-entry mistake, not two items.
CREATE TABLE IF NOT EXISTS product_skus (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku_code      text NOT NULL,
  variant_label text,
  uom           text NOT NULL DEFAULT 'Nos',
  list_rate     numeric(14,2),
  tally_item_name text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_skus_code_uq ON product_skus (lower(sku_code));
CREATE INDEX IF NOT EXISTS product_skus_product_idx ON product_skus (product_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · CUSTOMER MASTERS
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_masters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  code          text,
  -- "Mandatory assignment to a Salesperson" in the brief, but ON DELETE SET
  -- NULL: deactivating an employee must not cascade-delete their customers.
  -- The requirement is enforced at the form, where it can be explained.
  sales_rep_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  volume_class     text,
  purchase_pattern text,
  sensitivity      text,
  contact_person text,
  phone          text,
  email          text,
  city           text,
  state          text,
  gstin          text,
  -- Which Tally sub-group this came from, e.g. 'Sundry Debtors'.
  tally_group    text,
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  created_by_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_volume_class_ck CHECK (volume_class IS NULL OR volume_class IN ('A','B','C')),
  CONSTRAINT customer_pattern_ck CHECK (
    purchase_pattern IS NULL OR purchase_pattern IN ('regular','seasonal','one_time')
  ),
  CONSTRAINT customer_sensitivity_ck CHECK (
    sensitivity IS NULL OR sensitivity IN ('cost_sensitive','neutral','loyal')
  )
);
CREATE INDEX IF NOT EXISTS customer_masters_rep_idx ON customer_masters (sales_rep_id);
CREATE INDEX IF NOT EXISTS customer_masters_active_name_idx ON customer_masters (is_active, name);
CREATE INDEX IF NOT EXISTS customer_masters_class_idx ON customer_masters (volume_class);
CREATE UNIQUE INDEX IF NOT EXISTS customer_masters_code_uq ON customer_masters (lower(code)) WHERE code IS NOT NULL;

-- Customer → Category → Product → SKU. Every level below customer is nullable
-- so "this customer buys from the Motors category" is recordable before anyone
-- knows the exact SKU — which is the normal state when importing old data.
CREATE TABLE IF NOT EXISTS customer_product_map (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer_masters(id) ON DELETE CASCADE,
  category_id uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  product_id  uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_id      uuid REFERENCES product_skus(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_product_map_customer_idx ON customer_product_map (customer_id);
CREATE INDEX IF NOT EXISTS customer_product_map_sku_idx ON customer_product_map (sku_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · SYSTEM LIBRARIES
-- ════════════════════════════════════════════════════════════════════════════

-- ONE table for every editable dropdown in the app, keyed by `list_key`.
-- A table per list would mean a migration every time someone wants a new
-- dropdown — exactly what "without code updates" rules out.
CREATE TABLE IF NOT EXISTS lookup_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_key   text NOT NULL,
  label      text NOT NULL,
  value      text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active  boolean NOT NULL DEFAULT true,
  created_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lookup_items_key_label_uq ON lookup_items (list_key, lower(label));
CREATE INDEX IF NOT EXISTS lookup_items_key_idx ON lookup_items (list_key, is_active, sort_order);

-- Overdue-days slab → payout %. Slabs are half-open [from, to] in days.
CREATE TABLE IF NOT EXISTS incentive_slabs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label            text,
  overdue_from_days integer NOT NULL DEFAULT 0,
  overdue_to_days   integer,
  grace_days        integer NOT NULL DEFAULT 0,
  payout_pct        numeric(6,3) NOT NULL DEFAULT 0,
  sort_order        integer NOT NULL DEFAULT 100,
  is_active         boolean NOT NULL DEFAULT true,
  created_by_id     uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incentive_slabs_range_ck CHECK (
    overdue_to_days IS NULL OR overdue_to_days >= overdue_from_days
  ),
  CONSTRAINT incentive_slabs_pct_ck   CHECK (payout_pct >= 0 AND payout_pct <= 100),
  CONSTRAINT incentive_slabs_grace_ck CHECK (grace_days >= 0)
);
CREATE INDEX IF NOT EXISTS incentive_slabs_order_idx ON incentive_slabs (is_active, sort_order);

-- Seed the two reason lists from the brief. ON CONFLICT so a re-run is a no-op.
INSERT INTO lookup_items (list_key, label, sort_order) VALUES
  ('enquiry_pending_reason', 'Awaiting Specs',    10),
  ('enquiry_pending_reason', 'Client Review',     20),
  ('enquiry_pending_reason', 'Awaiting Approval', 30),
  ('enquiry_lost_reason',    'Delayed Delivery',  10),
  ('enquiry_lost_reason',    'Brand Mismatch',    20),
  ('enquiry_lost_reason',    'Price Issues',      30),
  ('enquiry_lost_reason',    'Lack of Agency',    40)
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · FIELD-LEVEL PERMISSIONS
-- ════════════════════════════════════════════════════════════════════════════

-- Deliberately mirrors module_access_grants (0076): same subject shape, same
-- resolution order (employee → department → everyone → code default). This is
-- the FIELD layer under the existing MODULE layer, not a second RBAC system.
-- subject_id is a department or employee id depending on subject_type, and
-- NULL for org-wide rows — hence no FK.
CREATE TABLE IF NOT EXISTS field_permission_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key    text NOT NULL,
  subject_type text NOT NULL,
  subject_id   uuid,
  allowed      boolean NOT NULL,
  updated_by   uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_permission_subject_ck CHECK (
    subject_type IN ('everyone','department','employee')
  )
);
CREATE INDEX IF NOT EXISTS field_permission_subject_idx ON field_permission_grants (subject_type, subject_id);
CREATE UNIQUE INDEX IF NOT EXISTS field_permission_scoped_uq
  ON field_permission_grants (field_key, subject_type, subject_id) WHERE subject_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS field_permission_everyone_uq
  ON field_permission_grants (field_key) WHERE subject_id IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · DATA INGESTION & TALLY MAPPING
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL DEFAULT 'csv',
  target      text NOT NULL,
  file_name   text,
  row_count   integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count  integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'draft',
  -- Column-name → field-name mapping the admin confirmed in the UI.
  mapping     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text,
  created_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_batches_source_ck CHECK (source IN ('csv','google_sheets','tally')),
  CONSTRAINT import_batches_target_ck CHECK (target IN ('customers','products','skus','categories')),
  CONSTRAINT import_batches_status_ck CHECK (status IN ('draft','applied','failed'))
);
CREATE INDEX IF NOT EXISTS import_batches_created_idx ON import_batches (created_at DESC);

-- Tally sub-group → where it lands here. target_category_id is nullable
-- precisely because old records often have no sub-classification to map.
CREATE TABLE IF NOT EXISTS tally_group_mappings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tally_group text NOT NULL,
  maps_to     text NOT NULL,
  target_category_id uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  note        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tally_maps_to_ck CHECK (maps_to IN ('customer','supplier','product','ignore'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tally_group_mappings_uq ON tally_group_mappings (lower(tally_group));

INSERT INTO tally_group_mappings (tally_group, maps_to, note) VALUES
  ('Sundry Debtors',   'customer', 'Tally receivables ledger — becomes a Customer master'),
  ('Sundry Creditors', 'supplier', 'Tally payables ledger — not a customer; ignored by customer import')
ON CONFLICT DO NOTHING;
