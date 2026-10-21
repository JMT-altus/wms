-- 0115 Collection Amount Confirmation + escalations to the commitments owner.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0112 (collection_master_companies)
-- and on "employees". Independent of 0110, 0113 and 0114.
--
-- collection_amount_confirmations — append-only history of "is the outstanding
--   amount from the approved transaction source correct?" (Yes / No) per
--   company. The current answer is the newest row; NO row means "Not set" (there
--   is no default). Rows are never updated or deleted by the app.
--
-- collection_escalations — a Tracker user escalates a company to the
--   commitments owner. At most ONE open escalation per company (partial unique
--   index). The owner closes it (closed_by / closed_at); the original escalation
--   fields are never changed, and a later escalation is a NEW row, so the full
--   history stays. `confirmation_at_escalation` is the confirmation in force at
--   that moment (NULL = not set). An escalation is not a commitment: it carries
--   no amount or date.
--
-- No direct REST access: RLS on with no policies, and the Supabase REST roles
-- (`anon`, `authenticated`) have no privileges — the app reads and writes only
-- from the server. Skipped cleanly where those roles don't exist.

CREATE TABLE IF NOT EXISTS "collection_amount_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "collection_master_companies"("id") ON DELETE RESTRICT,
  "value" text NOT NULL,
  "recorded_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_amount_confirmations_value_check" CHECK ("value" IN ('yes', 'no'))
);

CREATE INDEX IF NOT EXISTS "collection_amount_confirmations_company_idx"
  ON "collection_amount_confirmations" ("company_id", "recorded_at");

CREATE TABLE IF NOT EXISTS "collection_escalations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "collection_master_companies"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'open',
  "confirmation_at_escalation" text,
  "escalated_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "escalated_at" timestamptz NOT NULL DEFAULT now(),
  "closed_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "closed_at" timestamptz,
  CONSTRAINT "collection_escalations_status_check" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "collection_escalations_confirmation_check" CHECK ("confirmation_at_escalation" IS NULL OR "confirmation_at_escalation" IN ('yes', 'no')),
  CONSTRAINT "collection_escalations_closed_check" CHECK (
    ("status" = 'open' AND "closed_at" IS NULL AND "closed_by_id" IS NULL)
    OR ("status" = 'closed' AND "closed_at" IS NOT NULL)
  )
);

-- At most one OPEN escalation per company; closed ones are unlimited history.
CREATE UNIQUE INDEX IF NOT EXISTS "collection_escalations_one_open_uq"
  ON "collection_escalations" ("company_id") WHERE "status" = 'open';

CREATE INDEX IF NOT EXISTS "collection_escalations_company_idx"
  ON "collection_escalations" ("company_id", "escalated_at");

ALTER TABLE "collection_amount_confirmations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection_escalations" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collection_amount_confirmations', 'collection_escalations'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
