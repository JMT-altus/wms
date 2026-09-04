-- 0101 — park a customer as dormant.
--
-- A customer you have stopped trading with, but have not deleted and are not
-- willing to lose: it drops out of the Client Master, the Customer Master and
-- the three directories (Contact Master, Address Book, Bank Master), and comes
-- back only when the Status filter is set to Dormant.
--
-- A nullable timestamp, not a boolean, and not a third value of `is_active`:
--
--   is_active   a switch on a customer you still work with. An Inactive
--               customer stays in the list, reading "Inactive". Folding
--               dormancy into it would make every existing Inactive customer
--               disappear from every list the moment this deployed.
--   kyc_stage   where the record sits in ONBOARDING. Dormancy says nothing
--               about whether the KYC is finished, and a dormant client
--               reactivated a year later is still `complete`.
--
-- NULL means "not dormant", which is what every pre-0101 row already is, so
-- no backfill is needed and no existing row changes what it means.
--
-- The timestamp answers "dormant since when", which is the first thing anyone
-- asks of a parked account — same reasoning as `recycled_at` (0096).
--
-- Idempotent: IF NOT EXISTS on both statements, so apply-all-migrations.ts
-- can replay this file.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS dormant_at timestamptz;

-- Every list over this table now asks "and not dormant", so the kyc_stage
-- index alone stops covering the common read.
CREATE INDEX IF NOT EXISTS customer_masters_dormant_idx
  ON customer_masters (dormant_at);

COMMENT ON COLUMN customer_masters.dormant_at IS
  'When this customer was parked as dormant. NULL = not dormant. Distinct from is_active (a switch on a customer you still work with) and from kyc_stage (onboarding progress).';
