-- 0075 — allow unassigned tasks. Mihir Veera / Altus Corp can "quick dump"
-- tasks into a pool with no doer, then assign them later. `doer_id` becomes
-- nullable; NULL = unassigned. The FK + ON DELETE RESTRICT are unchanged.
-- Idempotent: DROP NOT NULL on an already-nullable column is a no-op.

ALTER TABLE tasks ALTER COLUMN doer_id DROP NOT NULL;
