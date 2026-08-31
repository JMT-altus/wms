-- 0093 — Client KYC: three kinds of Contact Person.
--
-- Contact Person was one undifferentiated list. A client actually keeps
-- separate people for purchasing and for accounts (the person who raises a
-- PO is rarely the person who settles the invoice), plus a catch-all for
-- everyone else. The form now shows three groups, each with its own
-- "Add More", so the type has to live on the row.
--
-- Text, not an enum type, to match gst_registration_type and the rest of the
-- 0088 columns — the set is application-owned (db/enums.ts CLIENT_CONTACT_TYPES)
-- and a fourth kind must not cost a migration.
--
-- Backfilled to 'other', NOT 'purchase': rows written before this migration
-- recorded no type at all, and calling them purchase contacts would invent a
-- fact. 'other' says exactly what is known — a contact of unrecorded kind.
-- NOT NULL is safe because the default fills every existing row first.

ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS contact_type text NOT NULL DEFAULT 'other';

-- Grouped reads ("all accounts contacts for this client") walk the existing
-- per-customer index and then filter; adding the type to that index keeps the
-- three groups on the KYC form a single index scan each.
CREATE INDEX IF NOT EXISTS customer_contacts_customer_type_idx
  ON customer_contacts (customer_master_id, contact_type, sort_order);
