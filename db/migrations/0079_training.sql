-- 0079 — Training Centre.
--
-- Eight surfaces, six tables. Everything else (Obligations, Dashboard) is
-- derived from these rather than stored, so there is no second copy of the
-- truth to drift.
--
--   training_materials          the library — a video/doc + who it's for
--   training_watches            who has watched what (one row per person+item)
--   training_sessions           scheduled sessions (the calendar)
--   training_session_attendance who turned up
--   training_session_feedback   attendees rate the session 1-5
--   self_learning_entries       personal learning log, evidence required
--   weekly_shares               the weekly 10-minute share
--   share_ratings               colleagues rate a share 1-5
--
-- Deliberately NOT included: a test/quiz engine. Materials are watched and
-- tracked; scoring is a separate build.

-- ── Library ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_materials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  subject      text,
  kind         text NOT NULL DEFAULT 'video_link',
  url          text,
  notes        text,
  -- Induction material is what every new hire must complete.
  is_induction boolean NOT NULL DEFAULT false,
  archived     boolean NOT NULL DEFAULT false,
  created_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_materials_kind_ck
    CHECK (kind IN ('video_link','document','pdf','slide','other'))
);
CREATE INDEX IF NOT EXISTS training_materials_created_idx ON training_materials (archived, created_at DESC);
CREATE INDEX IF NOT EXISTS training_materials_subject_idx ON training_materials (subject);
CREATE INDEX IF NOT EXISTS training_materials_induction_idx ON training_materials (is_induction) WHERE is_induction;

-- One row per (person, material). The PK enforces "watched" as a fact, not a
-- counter — re-watching is not a second row.
CREATE TABLE IF NOT EXISTS training_watches (
  material_id uuid NOT NULL REFERENCES training_materials(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  watched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (material_id, employee_id)
);
CREATE INDEX IF NOT EXISTS training_watches_employee_idx ON training_watches (employee_id);

-- ── Calendar ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_min integer NOT NULL DEFAULT 60,
  trainer_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  location     text,
  notes        text,
  cancelled    boolean NOT NULL DEFAULT false,
  created_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_sessions_when_idx ON training_sessions (scheduled_at);

CREATE TABLE IF NOT EXISTS training_session_attendance (
  session_id  uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  present     boolean NOT NULL DEFAULT true,
  marked_by_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, employee_id)
);

-- Feedback is ABOUT A SESSION, by the people who attended it. One rating per
-- person per session; editing overwrites rather than stacking.
CREATE TABLE IF NOT EXISTS training_session_feedback (
  session_id  uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  rating      integer NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, employee_id),
  CONSTRAINT training_session_feedback_rating_ck CHECK (rating BETWEEN 1 AND 5)
);

-- ── Self-learning ────────────────────────────────────────────────────────
-- Evidence is required in app code, not by the DB: a NOT NULL here would
-- reject legacy/imported rows and give the user a constraint error instead of
-- a field-level message.
CREATE TABLE IF NOT EXISTS self_learning_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'book',
  source        text NOT NULL,
  entry_date    date NOT NULL,
  minutes       integer NOT NULL DEFAULT 0,
  source_link   text,
  evidence_link text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_learning_kind_ck CHECK (kind IN ('book','video','youtube','other')),
  CONSTRAINT self_learning_minutes_ck CHECK (minutes >= 0)
);
CREATE INDEX IF NOT EXISTS self_learning_emp_date_idx ON self_learning_entries (employee_id, entry_date DESC);

-- ── Weekly share ─────────────────────────────────────────────────────────
-- week_start is the Monday, matching weekly_goals.week_start so both planners
-- bucket identically (see lib/weekly-goals/week.ts).
CREATE TABLE IF NOT EXISTS weekly_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start  date NOT NULL,
  topic       text NOT NULL,
  minutes     integer NOT NULL DEFAULT 10,
  video_link  text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_shares_emp_week_uq ON weekly_shares (employee_id, week_start);
CREATE INDEX IF NOT EXISTS weekly_shares_week_idx ON weekly_shares (week_start DESC);

CREATE TABLE IF NOT EXISTS share_ratings (
  share_id   uuid NOT NULL REFERENCES weekly_shares(id) ON DELETE CASCADE,
  rater_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  rating     integer NOT NULL,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (share_id, rater_id),
  CONSTRAINT share_ratings_rating_ck CHECK (rating BETWEEN 1 AND 5)
);
