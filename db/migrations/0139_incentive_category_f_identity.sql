-- 0139 Incentive calculation — Category F: a deterministic, database-enforced identity for email (F.2) and letterhead
-- (F.3) testimonials, and the input history of recovery write-offs.
--
-- Depends on 0138. PREPARED FOR REVIEW: never apply through pnpm db:migrate; apply only after a separate approval, through
-- its hash-pinned runner (scripts/incentive-0139/). Its rollback (db/rollback/0139_incentive_category_f_identity.rollback.sql)
-- restores 0138 exactly and refuses while any data only 0139 allows exists.
--
-- WHY. 0138 kept ONE free-text identity per email / letter (evidence_key, typed by the verifier), so the same email entered
-- once by its Message-ID and once by its sender, date and subject got two identities — and could earn twice. The
-- application now derives the identity deterministically (lib/incentives/categories/f-identity.ts) and 0139 stores it:
--   evidence_message_id   an email's Message-ID, normalised (no angle brackets, lower case); NULL when it shows none
--   evidence_fingerprint  ALWAYS for an email or letter: 'email:' + sha256(customer, sender address, date, subject), or
--                         'letter:' + sha256(customer, date)
--   evidence_key (0138)   the primary identity: 'email:mid:' + the Message-ID when there is one, else the fingerprint;
--                         'letter:ref:<customer>:<reference>' when the letter has a reference number, else the fingerprint
-- Each is UNIQUE among active verifications, across employees AND testimonial types, so the same email can't be verified
-- twice however its identity was entered (the second is refused; the application holds it for Admin Review). A Google
-- review has neither (its Google review ID and normalised link stay its identity). The identity check is NULL-safe.
-- Input history: entity 'f-writeoff' — every write-off request and decision is recorded there too (append-only), with the
-- employee, the recovery, the testimonials behind it, the amount, the reason, who and when.
--
-- No existing row changes: both new columns are NULL for every existing row. It REFUSES (changing nothing) while an email or
-- letterhead verification exists, because that has no derived identity (the application needs 0139 before it records
-- one). RLS and REST revocation are unchanged (no new table). Safe to re-run.

-- ── the identity columns ─────────────────────────────────────────────────────
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "evidence_message_id" text;
ALTER TABLE "incentive_f_decisions" ADD COLUMN IF NOT EXISTS "evidence_fingerprint" text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "incentive_f_decisions" WHERE "kind" = 'verify' AND "testimonial_kind" IN ('email', 'letterhead') AND "evidence_fingerprint" IS NULL) THEN
    RAISE EXCEPTION '0139 refused: an email or letterhead verification exists without a derived identity. Nothing was changed.' USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- An email: its fingerprint always; its Message-ID (normalised) when it has one; its primary key derived from them.
-- A letter: its fingerprint always; its primary key the fingerprint or its reference. A Google review and every other
-- decision: neither. (No customer column here: a deleted customer's link becomes NULL, which must never fail a check.)
ALTER TABLE "incentive_f_decisions" DROP CONSTRAINT IF EXISTS "incentive_f_decisions_identity_check";
ALTER TABLE "incentive_f_decisions" ADD CONSTRAINT "incentive_f_decisions_identity_check" CHECK (coalesce(CASE
    WHEN "kind" <> 'verify' OR "testimonial_kind" = 'google_review' THEN "evidence_message_id" IS NULL AND "evidence_fingerprint" IS NULL
    WHEN "testimonial_kind" = 'email' THEN "evidence_fingerprint" ~ '^email:[0-9a-f]{64}$'
      AND ("evidence_message_id" IS NULL OR ("evidence_message_id" ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+$' AND "evidence_message_id" = lower("evidence_message_id") AND length("evidence_message_id") <= 300))
      AND "evidence_key" = CASE WHEN "evidence_message_id" IS NULL THEN "evidence_fingerprint" ELSE 'email:mid:' || "evidence_message_id" END
    WHEN "testimonial_kind" = 'letterhead' THEN "evidence_message_id" IS NULL AND "evidence_fingerprint" ~ '^letter:[0-9a-f]{64}$'
      AND ("evidence_key" = "evidence_fingerprint" OR ("evidence_key" ~ '^letter:ref:[0-9a-f-]{36}:[^[:space:]]+$' AND "evidence_key" = lower("evidence_key")))
    ELSE false END, false)) NOT VALID;
ALTER TABLE "incentive_f_decisions" VALIDATE CONSTRAINT "incentive_f_decisions_identity_check";

-- One email / letter earns once: its Message-ID and its fingerprint are each verified once (across employees and types).
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_message_id_uq" ON "incentive_f_decisions" ("evidence_message_id") WHERE "kind" = 'verify' AND "retired_at" IS NULL AND "evidence_message_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_f_decisions_fingerprint_uq" ON "incentive_f_decisions" ("evidence_fingerprint") WHERE "kind" = 'verify' AND "retired_at" IS NULL AND "evidence_fingerprint" IS NOT NULL;

COMMENT ON COLUMN "incentive_f_decisions"."evidence_message_id" IS 'An email testimonial''s Message-ID, normalised (no brackets, lower case); unique among active verifications.';
COMMENT ON COLUMN "incentive_f_decisions"."evidence_fingerprint" IS 'An email''s sha256(customer, sender, date, subject) or a letter''s sha256(customer, date); unique among active verifications.';

-- ── input history: recovery write-offs ───────────────────────────────────────
ALTER TABLE "incentive_calc_input_history" DROP CONSTRAINT IF EXISTS "incentive_calc_input_history_entity_check";
ALTER TABLE "incentive_calc_input_history" ADD CONSTRAINT "incentive_calc_input_history_entity_check" CHECK ("entity" IN ('attribution', 'rep-history', 'receipt-event', 'b-override', 'c-review', 'f-decision', 'f-writeoff')) NOT VALID;
ALTER TABLE "incentive_calc_input_history" VALIDATE CONSTRAINT "incentive_calc_input_history_entity_check";
