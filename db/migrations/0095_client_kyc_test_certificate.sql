-- 0095 — Client KYC: "Test Certificate Needed" on Registration & Tax.
--
-- The other four fields joining that row (TIN No, IEC Code, Website, TCS
-- Applicable) already have columns — 0087 added them for the bulk-upload
-- workbook and the KYC form simply never rendered them. This one had no
-- column anywhere, so it is the only DDL the change needs.
--
-- Boolean NOT NULL DEFAULT false deliberately mirrors `tcs_applicable`, the
-- field sitting beside it on the same row and answering the same Yes/No
-- shape. Matching its sibling matters more here than matching
-- `export_client`'s nullable-text style: the two render as one pair, and
-- giving them different storage would mean two different meanings of "blank"
-- for two questions a user answers in the same breath. False reads as
-- "no test certificate required", which is the correct default for a client
-- nobody has been asked about.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS test_certificate_needed boolean NOT NULL DEFAULT false;
