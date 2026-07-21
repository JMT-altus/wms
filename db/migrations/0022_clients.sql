-- Clients — canonical list backing the "Client Name" picker on the task
-- forms (New Task + Edit Task).  Mirrors the departments table.
--
-- Unlike departments, INSERT is open to any authenticated user: the task
-- form exposes a "+ Add new client…" affordance so a doer can append a
-- client inline while creating a task, and that new name persists for
-- everyone next time.  UPDATE/DELETE stay admin-only.
--
-- Idempotent: create-if-not-exists + ON CONFLICT DO NOTHING so re-runs are
-- safe.

create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_active   boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists clients_active_name_idx
  on clients(is_active, name);

-- No seed — the original Altus client roster was removed during the JMT Drive
-- Solutions rebrand. JMT adds its own clients inline via the task form's
-- "+ Add new client…" affordance (or the admin roster).

------------------------------------------------------------------------
-- RLS — read by anyone authenticated, insert by anyone authenticated,
-- update admin-only, delete not exposed.
------------------------------------------------------------------------

alter table clients enable row level security;

drop policy if exists "clients_read_authenticated"   on clients;
drop policy if exists "clients_insert_authenticated" on clients;
drop policy if exists "clients_update_admin"         on clients;

create policy "clients_read_authenticated"
  on clients for select
  to authenticated
  using (true);

create policy "clients_insert_authenticated"
  on clients for insert
  to authenticated
  with check (true);

create policy "clients_update_admin"
  on clients for update
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- DELETE: not exposed.  Deactivate (is_active = false) instead.
revoke delete on clients from authenticated;
revoke delete on clients from anon;
