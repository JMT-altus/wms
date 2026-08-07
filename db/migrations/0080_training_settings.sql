-- 0080 — Training Centre policy knobs, admin-editable.
--
-- 0079 shipped these three numbers as constants in db/enums.ts, which meant
-- changing "1.5 hours a month" to "2 hours" was a code change. They are policy,
-- not physics — the MD and admins have to be able to move them without a
-- developer. They live on org_settings (the existing single-row org config)
-- rather than a new table, so there is one place to look for org policy.
--
-- Defaults match the constants they replace, so behaviour is unchanged until
-- someone deliberately edits them.

ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS training_self_learning_target_min integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS training_share_min_minutes        integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS training_cadence_days             integer NOT NULL DEFAULT 6;

-- Guard against a fat-fingered 0 or a negative, which would make the progress
-- bars divide by zero and the cadence banner scream permanently.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_training_ck') THEN
    ALTER TABLE org_settings ADD CONSTRAINT org_settings_training_ck CHECK (
      training_self_learning_target_min BETWEEN 1 AND 10080
      AND training_share_min_minutes    BETWEEN 1 AND 600
      AND training_cadence_days         BETWEEN 1 AND 365
    );
  END IF;
END $$;
