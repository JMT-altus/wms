-- 0110 — Collection follow-ups.
--
-- The Collection Tracker (Forms module) records, per party, WHEN the next
-- follow-up is and WHAT was said, as an append-only history: every save is a new
-- row with its author and timestamp, so the date-wise notes in the tracker are
-- simply the rows for that party in order, and the "next follow-up date" is the
-- latest row that carries one.
--
-- Deliberately NOT here: party names, debit, credit, outstanding and collection
-- person. Those come from the approved accounting source, which is not connected
-- yet; storing copies of them would create a second, conflicting set of records.
-- A follow-up therefore keys on the party NAME as the source gives it.
--
-- Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "collection_followups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "party_name" text NOT NULL,
  "next_followup_date" date,
  "note" text,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_followups_has_content_check"
    CHECK ("next_followup_date" IS NOT NULL OR btrim(coalesce("note", '')) <> '')
);

CREATE INDEX IF NOT EXISTS "collection_followups_party_idx"
  ON "collection_followups" (lower("party_name"), "created_at" DESC);
