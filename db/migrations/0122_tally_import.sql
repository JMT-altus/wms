-- 0122 Tally Data Import — batches, row audit, saved mappings, Vendor Master, Tally ledger, outstanding snapshots.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0000 (employees), customer masters and 0112
-- (collection_master_companies). Do not run anywhere shared until reviewed. Never apply through
-- `pnpm db:migrate` (it would also apply every other pending file); apply this one file, with the role the
-- app connects as (DATABASE_URL), through a hash-pinned wrapper.
--
-- Additive only: seven new, empty tables. No existing table is altered and no existing row changes.
--
-- WHY A SEPARATE LEDGER. sales_orders / invoices / receipts are the Incentive Tracker's calculation inputs:
-- each order needs an owning salesperson and an incentive category Tally does not hold, and a row there can
-- move someone's payout. Vendors, purchases, credit/debit notes and vendor payments had no table at all.
-- So every voucher lands in tally_documents, traceable to its file and row, and nothing here writes to those
-- three tables. tally_outstanding_lines is kept apart from tally_documents on purpose: a balance is a
-- position at a date, not a transaction, and must never be added to invoice totals.
--
-- Duplicate protection is in the database, not only the code:
--   tally_documents.identity is UNIQUE (type + financial year + document number, plus the vendor for purchase
--   side documents, because a bill number is only unique to its supplier);
--   tally_import_rows has one row per (batch, file row), so retrying cannot log or import a row twice.
--
-- Imported records and history are never deleted by the app: every reference to a batch is ON DELETE RESTRICT.
--
-- No direct REST access: RLS on with no policies, and the Supabase REST roles (`anon`, `authenticated`) have
-- no privileges — the app reads and writes only from the server. Skipped cleanly where those roles don't
-- exist (same pattern as 0114 / 0115 / 0117 / 0119 / 0120 / 0121). Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "tally_import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "category" text NOT NULL,
  "file_name" text NOT NULL,
  -- SHA-256 of the sheet's cells: how an interrupted import is resumed, and a repeat snapshot refused.
  "file_hash" text NOT NULL,
  "sheet_name" text,
  "headers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "mapping" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "as_of_date" date,
  "direction" text,
  "include_attention" boolean NOT NULL DEFAULT false,
  "period_from" date,
  "period_to" date,
  "financial_years" text[] NOT NULL DEFAULT '{}',
  "is_historical" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'running',
  "total_rows" integer NOT NULL DEFAULT 0,
  "imported_rows" integer NOT NULL DEFAULT 0,
  "skipped_rows" integer NOT NULL DEFAULT 0,
  "rejected_rows" integer NOT NULL DEFAULT 0,
  "failed_rows" integer NOT NULL DEFAULT 0,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "tally_import_batches_status_check" CHECK ("status" IN ('running', 'completed', 'partial', 'failed')),
  CONSTRAINT "tally_import_batches_direction_check" CHECK ("direction" IS NULL OR "direction" IN ('receivable', 'payable'))
);
CREATE INDEX IF NOT EXISTS "tally_import_batches_created_idx" ON "tally_import_batches" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "tally_import_batches_resume_idx" ON "tally_import_batches" ("category", "file_hash");

CREATE TABLE IF NOT EXISTS "tally_import_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" uuid NOT NULL REFERENCES "tally_import_batches"("id") ON DELETE RESTRICT,
  "row_no" integer NOT NULL,
  "status" text NOT NULL,
  "reason" text,
  "target_table" text,
  "target_id" uuid,
  "cells" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tally_import_rows_status_check" CHECK ("status" IN ('imported', 'skipped', 'rejected', 'failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "tally_import_rows_batch_row_uq" ON "tally_import_rows" ("batch_id", "row_no");
CREATE INDEX IF NOT EXISTS "tally_import_rows_status_idx" ON "tally_import_rows" ("batch_id", "status");

CREATE TABLE IF NOT EXISTS "tally_column_mappings" (
  "category" text PRIMARY KEY,
  "mapping" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "vendor_masters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "name_key" text NOT NULL,
  "code" text,
  "gstin" text,
  "pan_no" text,
  "tally_group" text,
  "phone" text,
  "email" text,
  "address" text,
  "state" text,
  "credit_period_days" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "import_batch_id" uuid REFERENCES "tally_import_batches"("id") ON DELETE RESTRICT,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_masters_name_key_uq" ON "vendor_masters" ("name_key");
CREATE INDEX IF NOT EXISTS "vendor_masters_gstin_idx" ON "vendor_masters" ("gstin") WHERE "gstin" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "tally_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "identity" text NOT NULL,
  "document_type" text NOT NULL,
  "document_no" text NOT NULL,
  "document_no_key" text NOT NULL,
  "document_date" date NOT NULL,
  "financial_year" text NOT NULL,
  "is_historical" boolean NOT NULL DEFAULT false,
  "party_name" text NOT NULL,
  "party_key" text NOT NULL,
  "party_gstin" text,
  "customer_master_id" uuid REFERENCES "customer_masters"("id") ON DELETE SET NULL,
  "vendor_master_id" uuid REFERENCES "vendor_masters"("id") ON DELETE SET NULL,
  "total_paise" bigint NOT NULL,
  "taxable_paise" bigint,
  "tax_paise" bigint,
  "ref_document_no" text,
  "ref_document_id" uuid REFERENCES "tally_documents"("id") ON DELETE SET NULL,
  "payment_mode" text,
  "reference_no" text,
  "adjustment_type" text,
  "due_date" date,
  "narration" text,
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "import_batch_id" uuid NOT NULL REFERENCES "tally_import_batches"("id") ON DELETE RESTRICT,
  "source_row" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tally_documents_total_check" CHECK ("total_paise" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "tally_documents_identity_uq" ON "tally_documents" ("identity");
CREATE INDEX IF NOT EXISTS "tally_documents_type_no_idx" ON "tally_documents" ("document_type", "document_no_key");
CREATE INDEX IF NOT EXISTS "tally_documents_type_date_idx" ON "tally_documents" ("document_type", "document_date");
CREATE INDEX IF NOT EXISTS "tally_documents_customer_idx" ON "tally_documents" ("customer_master_id");
CREATE INDEX IF NOT EXISTS "tally_documents_vendor_idx" ON "tally_documents" ("vendor_master_id");
CREATE INDEX IF NOT EXISTS "tally_documents_batch_idx" ON "tally_documents" ("import_batch_id");

CREATE TABLE IF NOT EXISTS "tally_outstanding_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" uuid NOT NULL REFERENCES "tally_import_batches"("id") ON DELETE RESTRICT,
  "line_key" text NOT NULL,
  "direction" text NOT NULL,
  "as_of_date" date NOT NULL,
  "party_name" text NOT NULL,
  "party_key" text NOT NULL,
  "customer_master_id" uuid REFERENCES "customer_masters"("id") ON DELETE SET NULL,
  "vendor_master_id" uuid REFERENCES "vendor_masters"("id") ON DELETE SET NULL,
  "collection_company_id" uuid REFERENCES "collection_master_companies"("id") ON DELETE SET NULL,
  "bill_ref" text,
  "bill_date" date,
  "due_date" date,
  "original_paise" bigint,
  "pending_paise" bigint NOT NULL,
  "narration" text,
  "source_row" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tally_outstanding_lines_direction_check" CHECK ("direction" IN ('receivable', 'payable'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "tally_outstanding_lines_batch_key_uq" ON "tally_outstanding_lines" ("batch_id", "line_key");
CREATE INDEX IF NOT EXISTS "tally_outstanding_lines_company_idx" ON "tally_outstanding_lines" ("collection_company_id");

ALTER TABLE "tally_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tally_import_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tally_column_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendor_masters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tally_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tally_outstanding_lines" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tally_import_batches', 'tally_import_rows', 'tally_column_mappings', 'vendor_masters', 'tally_documents', 'tally_outstanding_lines'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
