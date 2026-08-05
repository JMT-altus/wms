-- 0078 — everyone except the MD and admins sees only their own tasks.
--
-- 0077 introduced tasks.visibility and chose 'internal' (= everyone) as the
-- default, so that nothing changed for anyone until they opted in. Every row
-- that existed at the time was therefore left team-visible.
--
-- The org rule is now the inverse: a task is personal unless someone
-- deliberately shares it. Two changes are needed, and BOTH matter —
--
--   1. flip the column default, so everything created from now on is private;
--   2. backfill the existing 'internal' rows. Without this, every task that
--      already exists keeps its team-wide setting and the new rule does
--      nothing at all for the work the team is currently doing.
--
-- The backfill is deliberately blunt: 'internal' at this point in time means
-- "took the old default", not "someone chose to share this" — the picker only
-- shipped one commit ago, so there is no deliberate 'internal' worth keeping.
-- Anyone who does want a task team-wide can set it back from the task detail
-- page, and 'restricted' rows are left alone because those audiences WERE
-- chosen explicitly.
--
-- Admins are unaffected: lib/auth/task-visibility.ts skips the predicate
-- entirely for is_admin users, so the MD + admins keep seeing everything.
--
-- Projects are intentionally NOT touched. Their visibility lives on the root
-- node and the ask was specifically about tasks; the tasks listed under a
-- project are filtered by the task predicate regardless.

ALTER TABLE tasks ALTER COLUMN visibility SET DEFAULT 'private';

UPDATE tasks SET visibility = 'private' WHERE visibility = 'internal';

-- The old partial index was predicated on 'internal' being the common value.
-- After the backfill that is inverted — nearly every row is 'private' — so the
-- old predicate matches almost the whole table (all the write cost of a full
-- index, none of the selectivity). Re-point it at the now-rare values, which
-- is what the 'restricted' audience lookup actually probes.
DROP INDEX IF EXISTS tasks_visibility_idx;
CREATE INDEX IF NOT EXISTS tasks_visibility_idx
  ON tasks (visibility) WHERE visibility <> 'private';
