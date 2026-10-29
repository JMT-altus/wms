-- 0113 Attendance / leave / COM OFF / policy / salary tables: no direct REST access.
--
-- FOR REVIEW ONLY — NOT APPLIED. Do not run against production until the
-- checks in the HR attendance-correction report have been done there
-- (read-only): the role in DATABASE_URL must OWN these tables (or have
-- BYPASSRLS), otherwise enabling RLS without policies would block the app.
--
-- Why: none of these tables had row-level security, and none revoked the
-- Supabase REST roles. On Supabase, tables created in `public` are granted to
-- `anon` and `authenticated` by default, so with the public anon key (shipped to
-- every browser as NEXT_PUBLIC_SUPABASE_ANON_KEY) or a signed-in user's token
-- they could be read or changed through the REST API — bypassing every check
-- in the app (reasons, audit, self-correction, salary rules).
--
-- What: the app reaches these tables only from the server (DATABASE_URL), never
-- through supabase-js in the browser. So: enable RLS with NO policies (the
-- table owner, and service_role which has BYPASSRLS, are unaffected) and revoke
-- every privilege from `anon` and `authenticated`. Nothing else changes; no
-- data is touched. Idempotent: tables or roles that don't exist are skipped
-- (e.g. biometric_employee_map before 0111 is applied, or a plain local
-- Postgres without the Supabase roles).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'attendance_logs',
    'leave_requests',
    'leave_approvers',
    'comp_off_credits',
    'attendance_policy_changes',
    'holidays',
    'biometric_employee_map',
    'salary_runs',
    'salary_profiles',
    'salary_advances',
    'salary_policies',
    'salary_policy_consents'
  ];
  r text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
