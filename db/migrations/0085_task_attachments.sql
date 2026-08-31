-- 0085 — Task attachments: files AND links.
--
-- `documents.task_id` has existed (and been indexed) since the documents
-- module shipped, and lib/supabase/admin.ts calls the bucket "the document
-- library + task attachments" — but nothing ever wrote task_id and no task
-- screen ever showed an attachment. This migration finishes that job rather
-- than adding a second, parallel attachments table.
--
-- WHY LINKS LIVE IN THE SAME TABLE
-- A Drive link and an uploaded PDF are the same thing to the person reading a
-- task: "the document for this job". Splitting them across two tables would
-- mean two queries, two permission paths and two delete flows for one concept.
-- The XOR check below keeps each row honest: it is a file or a link, never
-- both and never neither.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS link_url text;

-- A link row has no object in storage, so the column can no longer be NOT NULL.
ALTER TABLE documents
  ALTER COLUMN storage_path DROP NOT NULL;

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_file_xor_link;
ALTER TABLE documents
  ADD CONSTRAINT documents_file_xor_link
  CHECK ((storage_path IS NOT NULL) <> (link_url IS NOT NULL));

-- Existing rows are all files (storage_path set, link_url null), so the check
-- is satisfied on the way in — no backfill needed.

-- documents_task_idx already exists from the original documents migration.
