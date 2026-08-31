-- 0086 — Customer Master additions: Credit Limit, Credit Period, Focused View,
-- and a safe auto-numbering sequence for Customer Code.
--
-- All three new columns are nullable/default-safe so existing customer_masters
-- rows keep working untouched, same rule 0081/0082 already follow for this
-- table.
--
-- Customer Code becomes system-generated going forward, but ONLY through the
-- /masters/customers screen (saveMasterCustomer /
-- app/(masters-module)/masters/actions.ts) — /master-setup/customers keeps
-- accepting a manually typed code exactly as it does today, untouched. A
-- DB-level `DEFAULT nextval(...)` can't reproduce the zero-padded string this
-- screen uses ("001", "002" …) because `code` is text, not integer, so the
-- padding happens in the app layer from this sequence instead of a column
-- default or an insert trigger — deliberately scoped to one screen, not a
-- table-wide behaviour change.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS credit_limit numeric(14,2),
  ADD COLUMN IF NOT EXISTS credit_period_days integer,
  ADD COLUMN IF NOT EXISTS focused_view boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS customer_masters_focused_view_idx
  ON customer_masters (focused_view);

-- Sequence for the next Customer Code. Starts just past the highest EXISTING
-- numeric code (leading zeros ignored via ::int, so "09" and "9" collide the
-- way you'd expect) so a new code can never clash with one that already
-- exists; non-numeric legacy codes are ignored for this calculation and are
-- left completely untouched, same as every other pre-existing code.
CREATE SEQUENCE IF NOT EXISTS customer_masters_code_seq;
SELECT setval(
  'customer_masters_code_seq',
  coalesce((select max(code::int) from customer_masters where code ~ '^[0-9]+$'), 0) + 1,
  false
);

-- Uniqueness is already enforced by 0081's customer_masters_code_uq
-- (unique index on lower(code), NULLs excluded) — nothing to add here. A
-- collision at insert already surfaces as the app's existing friendly
-- "That customer code is already in use." (dbError() matches Postgres 23505).
