-- 0087 — Customer Master bulk-upload rework: Basic Details / Account Details
-- fields on customer_masters, and a new customer_sales_lines table for the
-- Sales sheet.
--
-- All new customer_masters columns are nullable/default-safe, same rule
-- 0081/0086 already follow on this table — existing rows and the manual
-- create/edit form are completely unaffected; these columns are populated
-- only by the reworked bulk-upload import.
--
-- customer_sales_lines is a NEW, dedicated table — deliberately NOT built on
-- top of sales_orders/invoices. Those are single-value-per-row aggregates
-- feeding the incentive/KPI engine; repurposing them for a qty/rate/GST
-- line-item log would risk corrupting incentive calculations. One customer
-- (via customer_master_id) can have many rows: several material lines per
-- PO, several POs over time.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS invoice_mailing_address text,
  ADD COLUMN IF NOT EXISTS purchase_dept_contact text,
  ADD COLUMN IF NOT EXISTS accounts_dept_contact text,
  ADD COLUMN IF NOT EXISTS other_contact text,
  ADD COLUMN IF NOT EXISTS reference_by text,
  ADD COLUMN IF NOT EXISTS pan_no text,
  ADD COLUMN IF NOT EXISTS tin_number text,
  ADD COLUMN IF NOT EXISTS iec_number text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS sales_coordinator text,
  ADD COLUMN IF NOT EXISTS accounts_contact_name text,
  ADD COLUMN IF NOT EXISTS accounts_contact_phone text,
  ADD COLUMN IF NOT EXISTS accounts_contact_email text,
  ADD COLUMN IF NOT EXISTS tcs_applicable boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS customer_sales_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_master_id     uuid NOT NULL REFERENCES customer_masters(id) ON DELETE CASCADE,
  customer_po_no         text,
  customer_po_email_date date,
  material_description   text,
  qty                    numeric(14,2),
  rate                   numeric(14,2),
  total                  numeric(14,2),
  gst_percent            numeric(5,2),
  gst_amount             numeric(14,2),
  line_total             numeric(14,2),
  freight_charges        numeric(14,2),
  installation_charges   numeric(14,2),
  sales_total            numeric(14,2),
  tc_required            boolean NOT NULL DEFAULT false,
  special_instruction    text,
  remarks                text,
  filled_by              text,
  filled_by_name         text,
  filled_by_sign         text,
  instructed_by          text,
  entered_verified_by    text,
  created_by_id          uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_sales_lines_customer_idx
  ON customer_sales_lines (customer_master_id);
