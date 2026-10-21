-- 0116 Collection Master + follow-ups: no direct REST access.
--
-- PROPOSAL — FOR REVIEW ONLY — NOT APPLIED. Do not run anywhere shared until
-- the read-only checks in the Collection Master security report have been done
-- on that database. Never apply through `pnpm db:migrate` (it would also apply
-- every other pending file).
--
-- Tables (all in public, all reached by the app only from the server through
-- DATABASE_URL — never through supabase-js in the browser):
--   collection_followups        (0110) Tracker follow-up dates and notes
--   collection_master_imports   (0112) import + coordinator-change audit log
--   collection_master_companies (0112) companies, Sales Coordinator, payment terms
--
-- Why: 0110 and 0112 enabled no row-level security and revoked nothing. On
-- Supabase, tables created in `public` are granted to `anon` and
-- `authenticated` by default, so anyone holding the public anon key (or a
-- signed-in user's token) could read these through the REST API, and insert,
-- change or delete rows — bypassing the import approval, the audit log and the
-- Mihir-only coordinator check.
--
-- What (the 0114/0115 pattern): ENABLE row-level security with NO policies,
-- and REVOKE ALL from `anon` and `authenticated`. RLS is not FORCED, so the
-- table owner is unaffected; roles with BYPASSRLS (superuser, service_role)
-- are unaffected. No data, column, constraint or index changes.
--
-- Safety guard: if the role applying this neither owns a table nor bypasses
-- RLS, enabling RLS would hide every row from that role — and the app, which
-- connects with the same role, would see empty lists and failed writes. The
-- migration then STOPS with an error before changing anything. Apply it with the
-- role the app connects as (DATABASE_URL); the guard can't see a different
-- role the deployed app might use, which is why the read-only checks come first.
--
-- Depends on 0110 and 0112 (and through them on 0000 employees and 0081
-- customer_masters). A table that doesn't exist yet is skipped with a NOTICE;
-- re-run this file after applying the missing migration, or that table stays
-- unprotected. Idempotent: safe to re-run. Rollback (if ever needed):
-- ALTER TABLE ... DISABLE ROW LEVEL SECURITY, then re-grant only what was
-- deliberately granted before.

DO $$
DECLARE
  t text;
  r text;
  tables text[] := ARRAY['collection_followups', 'collection_master_imports', 'collection_master_companies'];
  present text[] := ARRAY[]::text[];
  can_bypass boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO can_bypass FROM pg_roles WHERE rolname = current_user;

  -- 1. Check every table first, so nothing is half-applied.
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE '0116: table public.% does not exist yet — skipped; re-run 0116 after its migration.', t;
      CONTINUE;
    END IF;
    IF NOT can_bypass AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t) <> current_user THEN
      RAISE EXCEPTION '0116: role % neither owns public.% nor bypasses RLS; enabling RLS would hide its rows from the app. Nothing was changed.', current_user, t;
    END IF;
    present := present || t;
  END LOOP;

  -- 2. Lock down the tables that exist.
  FOREACH t IN ARRAY present LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
