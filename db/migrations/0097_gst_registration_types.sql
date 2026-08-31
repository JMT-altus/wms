-- 0097 — seed the full GST registration type list.
--
-- 0088 seeded only 'Regular', following its own rule of seeding just the
-- value the reference design showed. But unlike Transporter or Bank Name,
-- this list isn't client-specific data an admin has to supply — it's the
-- fixed set of registration types the GST law itself defines. Leaving five
-- of the seven out meant every org had to retype the same statutory list
-- through /master-setup/libraries before the dropdown was usable.
--
-- Still lookup_items rather than a code enum, so the list stays editable
-- and an org can deactivate the types it never bills against.
--
-- ON CONFLICT covers the 'Regular' row 0088 already inserted and makes a
-- re-run a no-op, matching how apply-all-migrations.ts replays everything.
-- Sort orders continue 0088's by-10 sequence from Regular at 10.

INSERT INTO lookup_items (list_key, label, sort_order) VALUES
  ('gst_registration_type', 'Composition',    20),
  ('gst_registration_type', 'Unregistered',   30),
  ('gst_registration_type', 'SEZ',            40),
  ('gst_registration_type', 'Overseas',       50),
  ('gst_registration_type', 'UIN',            60),
  ('gst_registration_type', 'Deemed Export',  70)
ON CONFLICT DO NOTHING;
