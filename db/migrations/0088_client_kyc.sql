-- 0088 — Create New Client KYC form: new customer_masters columns, three new
-- repeatable child tables (Contact Person / Addresses / Bank Details), a
-- customer-scoped attachment slot on the existing documents table, and 11
-- new admin-editable lookup lists for the form's "+Add"-able dropdowns.
--
-- All customer_masters additions are nullable/default-safe, same rule
-- 0081/0086/0087 already follow on this table — existing rows, the manual
-- create/edit form and the bulk-upload workbook are completely unaffected.
-- documents.customer_master_id is a second, independently-nullable FK next
-- to the existing task_id — a document still belongs to exactly one owner
-- (a task OR a client), enforced in the app layer the same way storage_path
-- / link_url already are; no existing task-attachment row or behaviour
-- changes.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS customer_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS industry_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gst_registration_type text,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS other_references text,
  ADD COLUMN IF NOT EXISTS msme_udyam_no text,
  ADD COLUMN IF NOT EXISTS freight_charges text,
  ADD COLUMN IF NOT EXISTS transporter text,
  ADD COLUMN IF NOT EXISTS quantity_deviation text;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS customer_master_id uuid REFERENCES customer_masters(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS documents_customer_master_idx
  ON documents (customer_master_id);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_master_id uuid NOT NULL REFERENCES customer_masters(id) ON DELETE CASCADE,
  first_name         text,
  last_name          text,
  contact_no         text,
  email              text,
  designation_id     uuid REFERENCES designations(id) ON DELETE SET NULL,
  department_id      uuid REFERENCES departments(id) ON DELETE SET NULL,
  notes              text,
  is_primary         boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_contacts_customer_idx
  ON customer_contacts (customer_master_id);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_master_id uuid NOT NULL REFERENCES customer_masters(id) ON DELETE CASCADE,
  address_type       text NOT NULL CHECK (address_type IN ('billing', 'shipping')),
  line1              text,
  line2              text,
  line3              text,
  line4              text,
  city               text,
  state              text,
  country            text,
  pin_code           text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx
  ON customer_addresses (customer_master_id);

CREATE TABLE IF NOT EXISTS customer_bank_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_master_id uuid NOT NULL REFERENCES customer_masters(id) ON DELETE CASCADE,
  account_name       text,
  bank_name          text,
  account_no         text,
  ifsc_swift         text,
  branch             text,
  account_type       text,
  is_primary         boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_bank_accounts_customer_idx
  ON customer_bank_accounts (customer_master_id);

-- Seed values — only what the reference design actually showed as a
-- selected/example value. Bank Name is deliberately left empty (seeding
-- real bank names would be inventing data); everything else is extendable
-- from /master-setup/libraries.
INSERT INTO lookup_items (list_key, label, sort_order) VALUES
  ('customer_type', 'End User',             10),
  ('customer_type', 'Traders',               20),
  ('customer_type', 'OEMs',                  30),
  ('customer_type', 'Contract Manufacturer', 40),

  ('industry_type', 'Mining',              10),
  ('industry_type', 'Pharma',              20),
  ('industry_type', 'Petrochem',           30),
  ('industry_type', 'Wire Ind.',           40),
  ('industry_type', 'Tool Manufacturers',  50),
  ('industry_type', 'Defence',             60),
  ('industry_type', 'Consulting',          70),
  ('industry_type', 'Others',              80),

  ('gst_registration_type', 'Regular', 10),

  ('currency', 'INR', 10),

  ('country', 'India', 10),

  ('credit_days', '7',  10),
  ('credit_days', '15', 20),
  ('credit_days', '30', 30),
  ('credit_days', '45', 40),
  ('credit_days', '60', 50),
  ('credit_days', '90', 60),

  ('kyc_payment_terms', 'Against Delivery', 10),

  ('freight_charges', 'Paid by Us', 10),

  ('transporter', 'Blue Dart', 10),

  ('quantity_deviation', '±5%', 10),

  ('bank_account_type', 'Current', 10),
  ('bank_account_type', 'Savings', 20)
ON CONFLICT DO NOTHING;
