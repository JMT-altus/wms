-- 0096 — Client KYC: Draft stage, and the 7-day path to the Recycle Bin.
--
-- The form hard-requires only Company Name, so half-finished clients were
-- landing in the Client Master indistinguishable from real ones. A record
-- that misses anything in lib/masters/kyc-completeness.ts is now a draft:
-- visible in its own section, excluded from the Client Master, and swept to
-- the Recycle Bin after 7 days of no further work.
--
-- `kyc_stage` is one column with three states rather than two booleans,
-- because the states are mutually exclusive and two booleans would allow
-- "draft AND recycled", which means nothing. Text with a CHECK, matching
-- `customer_addresses.address_type` and the rest of this table's
-- application-owned vocabularies.
--
-- DEFAULT 'complete' is the important half of this migration: every existing
-- row predates the rule and is already live in the Client Master. Backfilling
-- them by the new standard would sweep real, in-use clients into a Draft
-- section overnight and start a 7-day deletion clock on them. The rule
-- applies from here forward; existing records are grandfathered, and any of
-- them can still be re-evaluated later by an explicit, deliberate pass.
--
-- `draft_since` is when the 7-day clock started, NOT `updated_at`: editing a
-- draft's notes should reset the clock (the record is being worked on), while
-- an unrelated background write to the row should not. Keeping the clock in
-- its own column makes that distinction possible instead of accidental.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS kyc_stage text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS draft_since timestamptz,
  ADD COLUMN IF NOT EXISTS recycled_at timestamptz;

ALTER TABLE customer_masters
  DROP CONSTRAINT IF EXISTS customer_masters_kyc_stage_ck;

ALTER TABLE customer_masters
  ADD CONSTRAINT customer_masters_kyc_stage_ck
  CHECK (kyc_stage IN ('draft', 'complete', 'recycled'));

-- The sweep asks exactly one question - "which drafts are older than 7 days"
-- - and the Draft and Recycle Bin lists both filter on the stage first.
CREATE INDEX IF NOT EXISTS customer_masters_kyc_stage_idx
  ON customer_masters (kyc_stage, draft_since);
