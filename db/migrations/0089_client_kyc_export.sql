-- 0089 — Create New Client KYC: the Export flag.
--
-- The reference design's Identity row carries an Export Yes/No that 0088
-- missed, so the field rendered on /masters/client-kyc/new with nowhere to
-- land. Nullable rather than NOT NULL DEFAULT false because "not answered
-- yet" and "explicitly not an exporter" are different facts for a KYC record
-- — every other 0088 column on this table follows the same rule.
--
-- Deliberately not a boolean: the form offers Yes/No today, and a KYC export
-- status realistically grows a third state (SEZ, deemed export) that a
-- boolean would force a second migration to express. Text keeps that open at
-- no cost, matching gst_registration_type and the other lookup-backed columns
-- 0088 added.

ALTER TABLE customer_masters
  ADD COLUMN IF NOT EXISTS export_client text;
