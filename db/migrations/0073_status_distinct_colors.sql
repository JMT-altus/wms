-- 0073 — give every status a DISTINCT, meaning-matched colour (no more repeats:
-- the four Follow-Ups shared one orange, Need Help/Need Info shared red, and
-- On Hold/Cancelled shared grey). Stored as hex so we're not limited to the
-- 11 preset tokens. Idempotent.

UPDATE status_settings SET color_token = CASE status
  WHEN 'dont_know'    THEN '#f59e0b'  -- Not Seen — amber (unread)
  WHEN 'not_started'  THEN '#3b82f6'  -- Not Started — blue (ready)
  WHEN 'initiated'    THEN '#06b6d4'  -- Initiated — cyan (kicked off)
  WHEN 'on_hold'      THEN '#64748b'  -- On Hold — slate grey (paused)
  WHEN 'follow_up'    THEN '#f97316'  -- Follow Up — orange
  WHEN 'follow_up_1'  THEN '#ea580c'  -- Follow Up 1 — deeper orange
  WHEN 'follow_up_2'  THEN '#c2410c'  -- Follow Up 2 — burnt orange
  WHEN 'follow_up_3'  THEN '#9a3412'  -- Follow Up 3 — darkest (most escalated)
  WHEN 'need_help'    THEN '#ef4444'  -- Need Help — red (urgent)
  WHEN 'need_info'    THEN '#ec4899'  -- Need Info — pink (a question)
  WHEN 'done'         THEN '#22c55e'  -- Done — green (success)
  WHEN 'approved'     THEN '#a855f7'  -- Approved — purple
  WHEN 'not_approved' THEN '#f43f5e'  -- Not Approved — rose (rejected)
  WHEN 'cancelled'    THEN '#52525b'  -- Cancelled — zinc (dead)
  WHEN 'transferred'  THEN '#92724e'  -- Transferred — brown (handed off)
  ELSE color_token
END
WHERE status IN ('dont_know','not_started','initiated','on_hold','follow_up','follow_up_1','follow_up_2','follow_up_3','need_help','need_info','done','approved','not_approved','cancelled','transferred');
