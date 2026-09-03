-- 0100 — put the real channel list on the Client KYC "Customer Type" field.
--
-- 0088 seeded `customer_type` with four placeholder values (End User,
-- Traders, OEMs, Contract Manufacturer) taken from the reference design.
-- The list the business actually sells against is the same six-way channel
-- split `customer_category` already carries (0082): OEM (L), OEM (NL),
-- User, Dealer, Sub dealer, Panel Builder/Electrician.
--
-- One insert covers every reader — the Client KYC form's Customer Type
-- multi-select, the Client Master bulk-import grid, the .xlsx template's
-- baked-in dropdown, and the import's own re-check all read this list from
-- lookup_items (see lib/queries/client-bulk-options.ts), so none of them
-- need a code change.
--
-- The four 0088 values are then deleted, so the picker offers the channel
-- list and nothing else. Nothing references lookup_items by id — a client's
-- Customer Type is stored as the label text in customer_masters.customer_types
-- — so the delete is safe, but it does NOT rewrite those stored labels: any
-- client still tagged 'Traders' etc. keeps showing it and has to be re-tagged
-- before its row round-trips through the bulk sheet again.
--
-- Ordering note: apply-all-migrations.ts replays every file in filename
-- order, so 0088 re-inserts these four each run and this delete has to sit
-- after it — which it does.
--
-- ON CONFLICT DO NOTHING keeps the insert a no-op on replay (unique index
-- lookup_items_key_label_uq on (list_key, lower(label))); the delete is
-- naturally idempotent.

INSERT INTO lookup_items (list_key, label, sort_order) VALUES
  ('customer_type', 'OEM (L)',                    10),
  ('customer_type', 'OEM (NL)',                   20),
  ('customer_type', 'User',                       30),
  ('customer_type', 'Dealer',                     40),
  ('customer_type', 'Sub dealer',                 50),
  ('customer_type', 'Panel Builder/Electrician',  60)
ON CONFLICT DO NOTHING;

-- Retire the 0088 placeholders.
DELETE FROM lookup_items
 WHERE list_key = 'customer_type'
   AND label IN ('End User', 'Traders', 'OEMs', 'Contract Manufacturer');
