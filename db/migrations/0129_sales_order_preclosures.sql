-- 0129 Sales Order pre-closures — the "Update" fields of Tally's Sales Order matrix.
--
-- Depends on 0000 (employees), 0122 (tally_documents) and 0127 (Sales Order
-- lines with their allocations). Independent of 0128. Never apply through
-- `pnpm db:migrate`; apply this one file with the role the app connects as
-- (DATABASE_URL), through a hash-pinned apply script, which also records it in
-- __schema_applied — and only with explicit approval.
--
-- WHY. The "Accounting Voucher (Read Me)" worksheet marks three Sales Order
-- fields "Update": Item Allocations - Pre-Close Quantity, - Reason for
-- Pre-Close and - Pre-Close Date. They don't create an order: they close part
-- (or all) of one delivery (item allocation) of an order that exists. The WMS
-- stores orders insert-only (tally_documents) and nothing may rewrite one, so a
-- pre-closure needs its own permanent record, with who made it and when.
--
-- WHAT.
--   sales_order_preclosures   one row per pre-closure of one delivery:
--     · which order (document_id), which product line (line_no) and which
--       delivery of it (allocation_no), both counted from 1 as the order page
--       shows them, with a snapshot of the item, its Order Due on and the
--       delivery's Billed Quantity;
--     · the Pre-Close Quantity, Reason for Pre-Close and Pre-Close Date;
--     · who recorded it (id and name at the time) and when;
--     · request_id: one per submission from the screen. Submitting the same
--       form twice (a double click, a retry after a lost reply) can never
--       record twice: the second insert is refused by the unique key.
--   The order itself is never changed. Rows are append-only (trigger): the one
--   change accepted is recorded_by_id becoming NULL when that employee is
--   deleted (ON DELETE SET NULL); recorded_by_name keeps who it was.
--   A BEFORE INSERT trigger checks against the stored order, under a lock on
--   the order's row (so two pre-closures of one order are serialised):
--     · the document is a Sales Order and the delivery exists in it;
--     · the snapshot (item, due date, Billed Quantity) is the stored one;
--     · the Pre-Close Date is not before the order's Voucher Date;
--     · everything pre-closed on the delivery stays within its Billed Quantity.
--   The application checks all of this first and says why; the database makes
--   sure no path can get round it.
--
-- No existing row is changed. No direct REST access: RLS on with no policies,
-- REST roles revoked (pattern of 0114 … 0128). Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "sales_order_preclosures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "tally_documents"("id") ON DELETE RESTRICT,
  -- 1 = the first product line / the first delivery of that line (tally_documents.lines[n-1].allocations[m-1]).
  "line_no" integer NOT NULL,
  "allocation_no" integer NOT NULL,
  -- Snapshot of the delivery when it was pre-closed (the stored order never changes; this makes each row readable alone).
  "item" text NOT NULL,
  "due_date" date,
  "ordered_quantity" numeric(20, 6) NOT NULL,
  -- The "Update" fields.
  "quantity" numeric(20, 6) NOT NULL,
  -- NULL only when an administrator has made the reason optional and none was given.
  "reason" text,
  "preclose_date" date NOT NULL,
  -- One per submission: the same submission can't be recorded twice.
  "request_id" uuid NOT NULL,
  "recorded_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "recorded_by_name" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sales_order_preclosures_request_uq" UNIQUE ("request_id"),
  CONSTRAINT "sales_order_preclosures_line_check" CHECK ("line_no" >= 1 AND "allocation_no" >= 1),
  CONSTRAINT "sales_order_preclosures_quantity_check" CHECK ("quantity" > 0 AND "ordered_quantity" > 0 AND "quantity" <= "ordered_quantity"),
  CONSTRAINT "sales_order_preclosures_reason_check" CHECK ("reason" IS NULL OR length(btrim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "sales_order_preclosures_item_check" CHECK (length(btrim("item")) >= 1),
  CONSTRAINT "sales_order_preclosures_by_check" CHECK (length(btrim("recorded_by_name")) >= 1)
);

CREATE INDEX IF NOT EXISTS "sales_order_preclosures_delivery_idx"
  ON "sales_order_preclosures" ("document_id", "line_no", "allocation_no", "recorded_at");

-- Every pre-closure is checked against the stored order, under a lock on the order's row.
CREATE OR REPLACE FUNCTION "sales_order_preclosures_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  doc record;
  alloc jsonb;
  closed numeric;
BEGIN
  SELECT "document_type", "document_date", "lines" INTO doc FROM "tally_documents" WHERE "id" = NEW."document_id" FOR UPDATE;
  IF NOT FOUND OR doc."document_type" <> 'sales-orders' THEN
    RAISE EXCEPTION 'A pre-closure belongs to a stored Sales Order' USING ERRCODE = 'check_violation';
  END IF;
  alloc := doc."lines" -> (NEW."line_no" - 1) -> 'allocations' -> (NEW."allocation_no" - 1);
  IF alloc IS NULL OR jsonb_typeof(alloc) <> 'object' THEN
    RAISE EXCEPTION 'That delivery is not in the order' USING ERRCODE = 'check_violation';
  END IF;
  IF (alloc ->> 'quantity')::numeric IS DISTINCT FROM NEW."ordered_quantity"
     OR (doc."lines" -> (NEW."line_no" - 1) ->> 'item') IS DISTINCT FROM NEW."item"
     OR (alloc ->> 'dueDate')::date IS DISTINCT FROM NEW."due_date" THEN
    RAISE EXCEPTION 'The pre-closure does not match the stored delivery' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."preclose_date" < doc."document_date" THEN
    RAISE EXCEPTION 'The Pre-Close Date is before the order''s Voucher Date' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum("quantity"), 0) INTO closed FROM "sales_order_preclosures"
    WHERE "document_id" = NEW."document_id" AND "line_no" = NEW."line_no" AND "allocation_no" = NEW."allocation_no";
  IF closed + NEW."quantity" > NEW."ordered_quantity" THEN
    RAISE EXCEPTION 'More than the delivery''s open quantity would be pre-closed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "sales_order_preclosures_check" ON "sales_order_preclosures";
CREATE TRIGGER "sales_order_preclosures_check" BEFORE INSERT ON "sales_order_preclosures" FOR EACH ROW EXECUTE FUNCTION "sales_order_preclosures_check"();

CREATE OR REPLACE FUNCTION "sales_order_preclosures_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The one permitted change: deleting an employee clears recorded_by_id (its ON DELETE SET NULL). Every other
  -- column must stay exactly as it was; any other UPDATE, and every DELETE, is refused.
  IF TG_OP = 'UPDATE' AND OLD."recorded_by_id" IS NOT NULL AND NEW."recorded_by_id" IS NULL
     AND (to_jsonb(NEW) - 'recorded_by_id') = (to_jsonb(OLD) - 'recorded_by_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Sales Order pre-closures are append-only' USING ERRCODE = 'restrict_violation';
END
$$;
DROP TRIGGER IF EXISTS "sales_order_preclosures_no_change" ON "sales_order_preclosures";
CREATE TRIGGER "sales_order_preclosures_no_change" BEFORE UPDATE OR DELETE ON "sales_order_preclosures" FOR EACH ROW EXECUTE FUNCTION "sales_order_preclosures_append_only"();

ALTER TABLE "sales_order_preclosures" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.sales_order_preclosures FROM %I', r);
    END IF;
  END LOOP;
END
$$;
