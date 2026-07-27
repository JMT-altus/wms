-- 0074 — assign distinct palette TOKENS (not raw hex) so the colours render on
-- every surface (many use var(--color-<token>) which needs a token name).
-- Supersedes 0073's hex. cyan/tangerine/crimson/pink are new tokens added in
-- this release (globals.css). Idempotent.

UPDATE status_settings SET color_token = CASE status
  WHEN 'dont_know'    THEN 'amber'
  WHEN 'not_started'  THEN 'blue'
  WHEN 'initiated'    THEN 'cyan'
  WHEN 'on_hold'      THEN 'slate'
  WHEN 'follow_up'    THEN 'orange'
  WHEN 'follow_up_1'  THEN 'yellow'
  WHEN 'follow_up_2'  THEN 'tangerine'
  WHEN 'follow_up_3'  THEN 'crimson'
  WHEN 'need_help'    THEN 'red'
  WHEN 'need_info'    THEN 'pink'
  WHEN 'done'         THEN 'green'
  WHEN 'approved'     THEN 'purple'
  WHEN 'not_approved' THEN 'rose'
  WHEN 'cancelled'    THEN 'stone'
  WHEN 'transferred'  THEN 'brown'
  ELSE color_token
END
WHERE status IN ('dont_know','not_started','initiated','on_hold','follow_up','follow_up_1','follow_up_2','follow_up_3','need_help','need_info','done','approved','not_approved','cancelled','transferred');
