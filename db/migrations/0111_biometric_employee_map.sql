-- 0111 — Biometric employee map.
--
-- The biometric machine's report identifies people by a numeric Employee Code and
-- a first name, never by email. JMT employees have no biometric code of their own,
-- and a first name alone is not safe to match on (names repeat). This table is the
-- single, explicit place where HR records "biometric code N is this JMT employee",
-- so the Attendance Bulk Upload can pre-select the right person next time.
--
-- Nothing is ever written here automatically: a row exists only because an admin
-- reviewed the match on the upload page and chose "Remember these matches". The
-- table starts EMPTY. It is not seeded from any report, name or guess.
--
--   * biometric_code is unique — a code can belong to exactly one person.
--   * employee_id is unique — a person has exactly one code on this machine, so a
--     second code for the same person has to be a deliberate, confirmed change.
--   * name_in_file is the name the report showed when HR confirmed the match. On a
--     later import a different name does NOT auto-select (the code may have been
--     reused); HR is asked to look again.
--   * Deleting an employee removes their mapping (ON DELETE CASCADE) — a mapping
--     with no person is meaningless. Deleting the HR user who confirmed it only
--     blanks confirmed_by_id (ON DELETE SET NULL); it never blocks that deletion.
--   * Every create / change / removal is also written to employee_events (event
--     types biometric_map_created / _changed / _confirmed / _removed) by the
--     application, in the same transaction as the change.
--
-- Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "biometric_employee_map" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "biometric_code" text NOT NULL,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "name_in_file" text NOT NULL DEFAULT '',
  "confirmed_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "confirmed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "biometric_employee_map_code_not_blank_check"
    CHECK (btrim("biometric_code") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "biometric_employee_map_code_uq"
  ON "biometric_employee_map" ("biometric_code");

CREATE UNIQUE INDEX IF NOT EXISTS "biometric_employee_map_employee_uq"
  ON "biometric_employee_map" ("employee_id");
