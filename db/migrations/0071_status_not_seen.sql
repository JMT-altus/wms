-- 0071 — Rename the "Don't Know" task status to "Not Seen" and recolour it from
-- grey (stone) to amber, since grey now reads as "On Hold". Idempotent.

UPDATE status_settings
   SET label = 'Not Seen', color_token = 'amber'
 WHERE status = 'dont_know';
