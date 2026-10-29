-- 0118 Collection escalations — Reason for Escalation.
--
-- FOR REVIEW ONLY — NOT APPLIED. Depends on 0115 (collection_escalations).
-- Do not run anywhere shared until reviewed. Never apply through
-- `pnpm db:migrate` (it would also apply every other pending file); apply this
-- one file, with the role the app connects as (DATABASE_URL).
--
-- Adds ONE nullable column, `reason`: why the person escalated the company.
--   * New escalations: the app requires a reason — trimmed, 1–1,000 characters —
--     and validates it on the server before anything is written.
--   * Existing escalations keep `reason` NULL: they were raised before a reason
--     was asked for, and no reason is invented for them (no backfill; no existing
--     row is changed). The review page says so instead of showing a reason.
-- The CHECK enforces the same bounds in the database for any non-null value
-- (at most 1,000 characters, and at least one non-whitespace character).
--
-- Access is unchanged: 0115 enabled RLS on the table with no policies and
-- revoked `anon` / `authenticated` at the TABLE level, which covers a new
-- column; no grant is added here.
--
-- Additive and safe to re-run (IF NOT EXISTS / existence check). The CHECK is
-- validated against the existing rows, which pass because their reason is NULL.

ALTER TABLE "collection_escalations" ADD COLUMN IF NOT EXISTS "reason" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_escalations_reason_check'
      AND conrelid = 'public.collection_escalations'::regclass
  ) THEN
    ALTER TABLE "collection_escalations" ADD CONSTRAINT "collection_escalations_reason_check"
      CHECK ("reason" IS NULL OR (char_length("reason") <= 1000 AND "reason" ~ '[^[:space:]]'));
  END IF;
END
$$;
