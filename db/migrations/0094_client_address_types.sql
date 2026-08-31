-- 0094 — Client KYC: three kinds of Address, plus an email on the mailing one.
--
-- 0088 modelled addresses as billing-or-shipping. A client actually keeps
-- three: where the invoice is raised (Billing), where the goods physically
-- go (Delivery), and where the invoice is posted or emailed (Invoice
-- Mailing) — the third is frequently a head office that receives no goods,
-- so folding it into "shipping" lost the distinction.
--
-- 'shipping' is renamed to 'delivery' rather than kept alongside it: they are
-- the same fact under two names, and leaving both would let two blocks on the
-- form mean the same thing. The UPDATE runs before the new CHECK so existing
-- rows satisfy it; it is a no-op on a database with none.
--
-- `email` is added to every address row, not just the mailing one. The form
-- only shows it on Invoice Mailing (that is where an emailed invoice is
-- actually addressed), but a per-row column costs nothing and avoids a
-- second migration if Billing ever needs one too.

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS email text;

UPDATE customer_addresses
   SET address_type = 'delivery'
 WHERE address_type = 'shipping';

ALTER TABLE customer_addresses
  DROP CONSTRAINT IF EXISTS customer_addresses_address_type_check;

ALTER TABLE customer_addresses
  ADD CONSTRAINT customer_addresses_address_type_check
  CHECK (address_type IN ('billing', 'delivery', 'invoice_mailing'));
