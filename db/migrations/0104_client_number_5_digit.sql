-- 0104 — Client Number: five digits, counting from 10001.
--
-- Client codes were three digits from a bare sequence ("001", "018"), which
-- reads as a row number rather than as a client's identifier and runs out at
-- 999. Every client now carries a five-digit Client Number instead, starting
-- at 10001, and existing clients are renumbered into that range.
--
-- Renumbering is safe to do: `customer_masters.code` is referenced nowhere as
-- a key. Every other table joins on the uuid; the code is read only to show
-- it (Client Master, Targets, Incentive, the exports). Nothing stores a code
-- as a foreign key, so changing one cannot orphan a row.

-- ── 1. Give every client a five-digit number ─────────────────────────────────
--
-- Only rows that don't already carry one, numbered from above the highest
-- existing five-digit code. That makes this re-runnable — a second pass finds
-- nothing to do — and means a new number can never collide with one already
-- issued, which matters because `customer_masters_code_uq` is enforced on
-- every intermediate row of the UPDATE, not just the final state.
--
-- Order is oldest first, so the register reads 10001, 10002, … in the order
-- clients were actually onboarded rather than in whatever order the old codes
-- happened to fall. Rows with no code at all are included: the requirement is
-- that EVERY client has a Client Number.
WITH start AS (
  SELECT coalesce(
           (SELECT max(code::int) FROM customer_masters WHERE code ~ '^[0-9]{5}$'),
           10000
         ) AS base
),
numbered AS (
  SELECT
    c.id,
    (SELECT base FROM start)
      + row_number() OVER (ORDER BY c.created_at, c.code NULLS LAST, c.id) AS n
  FROM customer_masters c
  WHERE c.code IS NULL OR c.code !~ '^[0-9]{5}$'
)
UPDATE customer_masters c
SET code = lpad(numbered.n::text, 5, '0')
FROM numbered
WHERE c.id = numbered.id;

-- ── 2. Carry the sequence on from there ──────────────────────────────────────
--
-- `false` for is_called, so the next nextval() RETURNS this value rather than
-- skipping it — the same convention 0086 used when it first set this up.
SELECT setval(
  'customer_masters_code_seq',
  coalesce((SELECT max(code::int) FROM customer_masters WHERE code ~ '^[0-9]+$'), 10000) + 1,
  false
);
