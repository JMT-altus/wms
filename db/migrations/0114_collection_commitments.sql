-- 0114 Collection commitments — committed amount + committed date per company.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0112 (collection_master_companies).
--
-- Visible to and recorded by ONE person only (the commitments owner, enforced
-- in lib/auth/collection-owner.ts on every page, action and query). Keyed by the
-- Collection Master company id, never by a free-typed name.
--
-- Append-only history: every save is a new row with who and when; the current
-- commitment is the newest row. The app never updates or deletes rows here.
--
-- No direct REST access: RLS on with no policies, and the Supabase REST roles
-- (`anon`, `authenticated`) have no privileges — the app reads and writes only
-- from the server. Skipped cleanly where those roles don't exist.

CREATE TABLE IF NOT EXISTS "collection_commitments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "collection_master_companies"("id") ON DELETE RESTRICT,
  "committed_amount" numeric(14, 2) NOT NULL,
  "committed_date" date NOT NULL,
  "recorded_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_commitments_amount_positive" CHECK ("committed_amount" > 0)
);

CREATE INDEX IF NOT EXISTS "collection_commitments_company_idx"
  ON "collection_commitments" ("company_id", "recorded_at" DESC);

ALTER TABLE "collection_commitments" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.collection_commitments FROM %I', r);
    END IF;
  END LOOP;
END
$$;
