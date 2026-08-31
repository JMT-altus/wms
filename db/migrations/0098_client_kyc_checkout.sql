-- 0098 — Client KYC: a draft checked out into the form leaves the Draft list.
--
-- Restore used to open a draft in the form and leave the row sitting in the
-- Draft list at the same time, so the same record appeared to be in two
-- places. What people expect is a checkout: Restore takes it out, Save to
-- Draft puts it back, Onboarding sends it to the Client Master.
--
-- A nullable timestamp rather than a fourth `kyc_stage` value, because this
-- is not a fourth stage — the row is still a draft in every way that matters
-- (the completeness rule, the 7-day clock, and every write path that scopes
-- itself to kyc_stage = 'draft' all keep working untouched). It is a draft
-- that happens to be open on someone's screen, which is a property of the
-- draft, not a replacement for being one.
--
-- Why a timestamp and not a boolean: a checked-out row is hidden from the
-- Draft list, so an abandoned checkout — the browser closed with the form
-- open — would be invisible everywhere. The time is what lets the sweep put
-- it back after CHECKOUT_EXPIRY_MINUTES, which is the guarantee that nothing
-- can be stranded. A boolean could record the state but never expire it.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS editing_since timestamptz;

-- The Draft list's query is "drafts that are not checked out", and the sweep's
-- is "checkouts older than N minutes". Both start from this column.
CREATE INDEX IF NOT EXISTS customer_masters_editing_idx
  ON customer_masters (editing_since)
  WHERE editing_since IS NOT NULL;
