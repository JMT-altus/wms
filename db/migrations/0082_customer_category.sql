-- 0082 — Customer category (OEM (L) / OEM (NL) / User / Dealer / Sub dealer /
-- Panel Builder-Electrician).
--
-- This is the customer's TYPE OF BUSINESS, and is a different axis from the
-- three classifications 0081 already stores:
--   volume_class      A / B / C          — how much they buy
--   purchase_pattern  regular/seasonal…  — how often
--   sensitivity       cost/neutral/loyal — why they buy
--   customer_category OEM / Dealer / …   — what they ARE   ← this migration
--
-- Deliberately a free-text column backed by the `lookup_items` list rather than
-- a CHECK constraint or a pgEnum. The brief for this module was explicitly
-- "admins can change it without a developer": a CHECK would mean a migration
-- every time the sales team invents a channel, which is exactly what the
-- editable-libraries table exists to avoid. The six values below are seeds, not
-- a closed set — /master-setup/libraries manages them from here on.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS customer_category text;

CREATE INDEX IF NOT EXISTS customer_masters_category_idx
  ON customer_masters (customer_category);

INSERT INTO lookup_items (list_key, label, sort_order) VALUES
  ('customer_category', 'OEM (L)',                    10),
  ('customer_category', 'OEM (NL)',                   20),
  ('customer_category', 'User',                       30),
  ('customer_category', 'Dealer',                     40),
  ('customer_category', 'Sub dealer',                 50),
  ('customer_category', 'Panel Builder/Electrician',  60)
ON CONFLICT DO NOTHING;
