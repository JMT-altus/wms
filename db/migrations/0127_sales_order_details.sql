-- 0127 Sales Order details — Forms → Sales Orders → Import Sales Orders.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0122 (tally_documents). Independent
-- of every other pending file. Never apply through `pnpm db:migrate`; apply this
-- one file with the role the app connects as (DATABASE_URL), through the
-- hash-pinned apply script, then record it in __schema_applied.
--
-- WHY. The Sales Order import now carries every field TallyPrime's voucher
-- matrix marks Y, ? or Provision for a Sales Order (lib/tally/sales-order-
-- catalogue.ts: 90 fields). tally_documents (0122) has columns for about 15 of
-- them, and the product-line fields fit in its existing `lines` jsonb. What has
-- nowhere to go is the ORDER-level information: order date and terms, dispatch,
-- the buyer's and consignee's details, every ledger entry (with its rate,
-- narration, description and cost-centre allocations), the voucher states and
-- additional costs. Without this column an import would have to drop them —
-- which the import refuses to do (it holds back instead).
--
-- WHAT. One nullable-by-default jsonb column on the existing table, written
-- only by the Sales Order import (shape: SalesOrderDetails in the catalogue,
-- `version: 1`). '{}' for every other document type and every row already
-- there. No new table, no new index, no row is changed, no constraint is added
-- or removed. RLS and grants on tally_documents are unchanged (0122/0113).
--
-- Additive and safe to re-run.

ALTER TABLE "tally_documents" ADD COLUMN IF NOT EXISTS "details" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN "tally_documents"."details" IS 'Sales Orders: the order-level fields of TallyPrime''s Sales Order matrix (voucher, order, dispatch, buyer, consignee, ledger entries, voucher states, additional costs). ''{}'' for other document types. Written by the Sales Order import only.';
