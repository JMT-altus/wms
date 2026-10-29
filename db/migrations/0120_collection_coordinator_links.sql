-- 0120 Collection coordinator links — which WMS login IS which Sales Coordinator.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0000 (employees). Do not run anywhere
-- shared until reviewed. Never apply through `pnpm db:migrate` (it would also apply
-- every other pending file); apply this one file, with the role the app connects
-- as (DATABASE_URL), through a hash-pinned wrapper.
--
-- The Collection Master assigns companies to a Sales Coordinator LABEL (free text
-- from the master file). Nothing linked a login to a label, so the Collection
-- Tracker could not show a salesperson their own scorecard. This table is that
-- link, kept by a super-admin in the Admin Panel — never guessed from names,
-- initials or email addresses, and never created automatically. It starts EMPTY.
--
--   * employee_id is the key (a stable id, never a display name): one row per
--     login at most.
--   * coordinator_label is the label exactly as the Collection Master spells it
--     (validated by the app against the labels in the master when set), or NULL =
--     "this login is explicitly NOT a Sales Coordinator" (an admin or system
--     account). No row at all = not configured yet.
--   * A label belongs to at most ONE login (partial unique index), so two people
--     can never both see the same salesperson's scorecard through this link.
--   * Deleting an employee removes their link (ON DELETE CASCADE); deleting the
--     admin who set it only blanks set_by_id (ON DELETE SET NULL).
--   * Every create / change / removal is also written to employee_events by the
--     application, in the same transaction.
--
-- No direct REST access: RLS on with no policies, and the Supabase REST roles
-- (`anon`, `authenticated`) have no privileges — the app reads and writes only
-- from the server. Skipped cleanly where those roles don't exist (same pattern as
-- 0114 / 0115 / 0117 / 0119). Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "collection_coordinator_links" (
  "employee_id" uuid PRIMARY KEY REFERENCES "employees"("id") ON DELETE CASCADE,
  "coordinator_label" text,
  "set_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "set_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_coordinator_links_label_not_blank_check"
    CHECK ("coordinator_label" IS NULL OR btrim("coordinator_label") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "collection_coordinator_links_label_uq"
  ON "collection_coordinator_links" ("coordinator_label") WHERE "coordinator_label" IS NOT NULL;

ALTER TABLE "collection_coordinator_links" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.collection_coordinator_links FROM %I', r);
    END IF;
  END LOOP;
END
$$;
