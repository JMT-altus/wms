-- 0107 — Optional holidays.
--
-- The 2026 holiday list marks some days (Gudi Padwa, Dussehra) as OPTIONAL:
-- each employee may take any ONE optional holiday or a comp-off, and works a
-- full day on the rest. Until now every active row in `holidays` was a day off
-- for everybody (the attendance grader reads the active dates and credits "H"),
-- so an optional day stored as an ordinary holiday would have become mandatory.
--
-- This adds the distinction. An OPTIONAL row is listed in the Upcoming Holidays
-- card with a badge, and is deliberately left OUT of attendance grading — staff
-- work it unless they take it as their one optional day, through the existing
-- leave / comp-off flow.
--
-- Additive and safe to re-run: existing rows become `false`, i.e. mandatory,
-- which is exactly how they have always behaved.

ALTER TABLE "holidays"
  ADD COLUMN IF NOT EXISTS "is_optional" boolean NOT NULL DEFAULT false;
