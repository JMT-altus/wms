-- 0052 — client roster + task-data cleanup.
--
-- The original migration merged/deactivated Altus Corp's specific customer-name
-- variants. Those Altus customer names were removed during the JMT Drive
-- Solutions rebrand (JMT starts with an empty client roster — see 0022 and the
-- 0067 clear migration), so the merge logic no longer applies.
--
-- The reversibility backup table is kept (harmless, empty) so the ledger and any
-- tooling that references it stay intact.

create table if not exists client_cleanup_backup_0052 (
  task_id      uuid,
  old_client   text,
  new_client   text,
  backed_up_at timestamptz not null default now()
);

-- (No merges/deactivations — JMT has no Altus client history to clean up.)
