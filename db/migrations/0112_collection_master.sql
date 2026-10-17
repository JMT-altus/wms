-- 0112 — Collection Master.
--
-- The company reference list behind the Collection screens: each company's name,
-- its Sales Coordinator LABEL exactly as the master file has it, and its payment
-- terms as written. Reference data only — no amounts, invoices, due dates or
-- payment statuses live here; those come from a collection-transaction source
-- that has not been chosen yet. Future transaction rows must reference
-- collection_master_companies.id, not the company name.
--
-- Deliberately separate from the Client Master (customer_masters): importing
-- this list never creates, edits or deletes a client. A company is linked to a
-- Client Master record only when exactly one has the same exact name; the link
-- is SET NULL if that client is ever deleted.
--
--   * name_key is the company identity (lower-case letters and digits only) and
--     is UNIQUE, so two spellings of one company can never become two rows. The
--     application resolves same-key rows before writing; the index is the
--     backstop (a concurrent insert of the same key is skipped, not duplicated).
--   * coordinator_label NULL means Unassigned (blank, XXX or "-" in the file).
--     It is a label, not an employee: no mapping to employees is implied.
--   * payment_terms NULL means the file had none; nothing is inferred.
--   * Every import writes one collection_master_imports row: who, when, which
--     file and column mapping, the totals, and each inserted/updated company
--     with its before/after values. Imports never delete.
--
-- Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "collection_master_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_name" text,
  "sheet_name" text,
  "column_mapping" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ignored_columns" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "totals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "changes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "imported_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "imported_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "collection_master_imports_at_idx"
  ON "collection_master_imports" ("imported_at" DESC);

CREATE TABLE IF NOT EXISTS "collection_master_companies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_name" text NOT NULL,
  "name_key" text NOT NULL,
  "coordinator_label" text,
  "payment_terms" text,
  "customer_master_id" uuid REFERENCES "customer_masters"("id") ON DELETE SET NULL,
  "client_match" text NOT NULL DEFAULT 'none',
  "created_import_id" uuid REFERENCES "collection_master_imports"("id") ON DELETE SET NULL,
  "last_import_id" uuid REFERENCES "collection_master_imports"("id") ON DELETE SET NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "updated_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_master_companies_name_not_blank_check" CHECK (btrim("company_name") <> ''),
  CONSTRAINT "collection_master_companies_key_not_blank_check" CHECK ("name_key" <> ''),
  CONSTRAINT "collection_master_companies_client_match_check" CHECK ("client_match" IN ('none', 'linked', 'ambiguous'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "collection_master_companies_name_key_uq"
  ON "collection_master_companies" ("name_key");

CREATE INDEX IF NOT EXISTS "collection_master_companies_customer_idx"
  ON "collection_master_companies" ("customer_master_id");
