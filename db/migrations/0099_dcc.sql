-- 0099 — DCC (Daily Compliance Checklist)
--
-- Per-employee daily KPI checklist. Every person owns a list of KPI items;
-- each item carries a schedule (daily / specific weekdays / weekly / monthly /
-- adhoc / event) and on every working day the owner marks each DUE item
-- Done / Not done / NA / Pending, optionally with a number and a note.
--
-- The single most important rule lives in `schedule_kind`: ONLY
-- schedule_kind='scheduled' AND is_participant_list=false items count toward
-- the daily due-set, the compliance %, the streak and any gate. Weekly,
-- monthly, adhoc, event and participant-list KPIs live in their own trays and
-- never block or inflate anything.
--
-- Written defensively (create-if-not-exists) like every migration from 0023+,
-- so apply-all-migrations.ts can re-run it against a populated database.

-- ── Section instancing ────────────────────────────────────────────────────
-- A "client" is an INSTANCE of a section, so the same section can repeat per
-- client (Section B for "Client X", again for "Client Y") without duplicating
-- the item definitions in the UI. Declared before dcc_kpi_items because that
-- table references it.
CREATE TABLE IF NOT EXISTS dcc_clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  section           text NOT NULL,
  name              text NOT NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  archived          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dcc_clients_owner_section_name_uq
  ON dcc_clients (owner_employee_id, section, lower(name));

-- ── Participant roster ────────────────────────────────────────────────────
-- External people (NOT employees) tracked by a participant-list KPI, e.g.
-- "Follow up with each mentee" over Nikunj, Parimal, … Deduped per owner by
-- lower(name) so "Nikunj" and "nikunj " never become two people.
CREATE TABLE IF NOT EXISTS dcc_subjects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name              text NOT NULL,
  kind              text,
  sort_order        integer NOT NULL DEFAULT 0,
  archived          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dcc_subjects_owner_name_uq
  ON dcc_subjects (owner_employee_id, lower(name));

-- ── KPI definitions ───────────────────────────────────────────────────────
-- Managers/admins author; the owner fills. `frequency` keeps the raw human
-- string ("Wed & Sat", "Every Sat", "As per HH call scheduled") and
-- parseFrequency() derives `weekdays` + `schedule_kind` from it at write time.
-- `needs_review` marks a frequency the parser could not classify — a human
-- should look at it. Unparseable NEVER means "due every day".
CREATE TABLE IF NOT EXISTS dcc_kpi_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  section             text,
  code                text,
  title               text NOT NULL,
  frequency           text,
  -- Bitmask, bit0=Mon … bit6=Sun. NULL or 0 = always due.
  weekdays            smallint,
  schedule_kind       text NOT NULL DEFAULT 'scheduled',
  is_participant_list boolean NOT NULL DEFAULT false,
  client_id           uuid REFERENCES dcc_clients(id) ON DELETE CASCADE,
  template_code       text,
  needs_review        boolean NOT NULL DEFAULT false,
  target_number       numeric(14,2),
  unit                text,
  sort_order          integer,
  archived            boolean NOT NULL DEFAULT false,
  created_by_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dcc_kpi_items_owner_idx
  ON dcc_kpi_items (owner_employee_id, sort_order);
CREATE INDEX IF NOT EXISTS dcc_kpi_items_client_idx ON dcc_kpi_items (client_id);

-- ── Which subjects a participant-list KPI tracks ──────────────────────────
-- Optional per-subject schedule override, so one mentee can be weekly while
-- the rest of the roster is daily.
CREATE TABLE IF NOT EXISTS dcc_item_subjects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES dcc_kpi_items(id) ON DELETE CASCADE,
  subject_id    uuid NOT NULL REFERENCES dcc_subjects(id)  ON DELETE CASCADE,
  schedule_kind text,
  weekdays      smallint,
  sort_order    integer NOT NULL DEFAULT 0,
  archived      boolean NOT NULL DEFAULT false,
  CONSTRAINT dcc_item_subjects_item_subject_uq UNIQUE (item_id, subject_id)
);

-- ── Entries: one fill per (item, date, subject) ───────────────────────────
-- subject_id NULL = a simple KPI's own row.
CREATE TABLE IF NOT EXISTS dcc_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES dcc_kpi_items(id) ON DELETE CASCADE,
  entry_date   date NOT NULL,
  status       text,
  value_number numeric(14,2),
  note         text,
  filled_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  subject_id   uuid REFERENCES dcc_subjects(id) ON DELETE CASCADE,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- CRITICAL: uniqueness must span the NULLABLE subject axis. In Postgres a
-- plain UNIQUE (item_id, entry_date, subject_id) does NOT dedupe rows where
-- subject_id IS NULL (every NULL is distinct), and conversely a 2-column
-- unique on (item_id, entry_date) rejects the participant rows outright.
-- A COALESCE-sentinel EXPRESSION index is the only shape that handles both —
-- and the upsert's ON CONFLICT must target this exact expression.
CREATE UNIQUE INDEX IF NOT EXISTS dcc_entries_subject_uq ON dcc_entries
  (item_id, entry_date, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS dcc_entries_date_idx    ON dcc_entries (entry_date);
CREATE INDEX IF NOT EXISTS dcc_entries_subject_idx ON dcc_entries (subject_id);
-- Roster reads fetch "every entry for these owners since date"; the join goes
-- item → entries, so lead with item_id.
CREATE INDEX IF NOT EXISTS dcc_entries_item_date_idx ON dcc_entries (item_id, entry_date);

-- ── Manager sign-off for one person's one day ─────────────────────────────
CREATE TABLE IF NOT EXISTS dcc_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  review_date       date NOT NULL,
  reviewer_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
  status            text,
  note              text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_reviews_owner_date_uq UNIQUE (owner_employee_id, review_date)
);
CREATE INDEX IF NOT EXISTS dcc_reviews_date_idx ON dcc_reviews (review_date);
