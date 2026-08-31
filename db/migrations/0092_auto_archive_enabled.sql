-- 0092 — separate "is auto-archiving on?" from "how long to wait".
--
-- 0091 overloaded a single integer: 0 meant "never archive". That left no way
-- to express "archive as soon as it is approved", which is the behaviour
-- actually wanted — the delay is optional, the approval is the trigger.
--
-- With the flag split out:
--   enabled = false            → never archives (default, unchanged behaviour)
--   enabled = true,  days = 0  → archives on the next sweep after approval
--   enabled = true,  days = 7  → archives a week after approval
--
-- Defaults to false so this migration changes nothing on its own; an admin
-- still has to switch it on.

ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS auto_archive_approved_enabled boolean NOT NULL DEFAULT false;
