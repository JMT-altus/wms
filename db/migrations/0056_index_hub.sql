-- Index hub — the Ecosystem Index, brought into the app as an editable tab.
-- Two tables: sections and the hyperlink buttons under them. Admins add/remove
-- both from the UI; everyone can view.
-- Idempotent: create-if-not-exists.
--
-- NOTE: the original Altus seed (its internal Google-Drive links) was removed
-- during the JMT Drive Solutions rebrand. JMT starts with an empty index hub and
-- adds its own sections/links from the admin UI.

create table if not exists index_sections (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists index_links (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references index_sections(id) on delete cascade,
  label       text not null,
  url         text not null,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists index_links_section_idx on index_links (section_id, sort_order);

-- (No seed — JMT populates the index hub from the admin UI.)
