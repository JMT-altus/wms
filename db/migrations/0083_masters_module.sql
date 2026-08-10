-- 0083 — Masters module (/masters, hub module id `masters`).
--
-- The module itself needs no table: module_access_grants (0076) is keyed by a
-- free-text module_id, and lib/access/modules.ts supplies the code default
-- (false — opened deliberately, like Employees and the Incentive Tracker).
-- Nothing is seeded here on purpose: an absent row means "inherited", which is
-- what the matrix should show before an admin has decided anything.
--
-- The one schema change is products.specification.
--
-- `description` already exists and is the long-form blurb the Phase-1
-- catalogue screen (/master-setup/products) writes. `specification` is the
-- technical string the Masters screen records — "Flat 102 x 36 x 9.2, CIW06,
-- VSI". Separate columns rather than one shared field so neither screen
-- silently overwrites what the other put there; both surfaces read the same
-- `products` rows, so there is still exactly one product list.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS specification text;

-- Backs the Masters product search, which matches on code as often as name.
CREATE INDEX IF NOT EXISTS products_code_idx ON products (code);
