-- 0141 Incentive calculation — two-person write-off of a carried-forward (below-minimum) balance.
--
-- NOT APPLIED. Prepared only; it needs its own approval. Depends on 0131–0136, which it extends; none of them is
-- changed. Never apply through pnpm db:migrate; apply this one file only through a hash-pinned runner after a separate
-- approval. Its rollback is db/rollback/0141_incentive_carry_writeoffs.rollback.sql.
--
-- WHY. A balance held below the minimum payable (0136's carry-forward ledger) could be written off by ONE person holding
-- the Record payout right. A write-off forgoes money a salesperson earned, so — as for Category F's recovery write-offs
-- (0137) — one person now requests it and a SECOND person approves or refuses it, each with a reason, and every step is
-- kept.
--
-- WHAT.
--   incentive_calc_carry_writeoffs   request / approve / refuse of a write-off of what remains of ONE held lot:
--                                      request   who asks, the amount (what remains when asked) and the reason;
--                                      approve   a second person; records the ledger's 'written-off' entry (result_carry_id)
--                                                for exactly the requested amount;
--                                      refuse    a second person, with the reason; nothing is written off.
--                                    One open request per lot; one decision per request; never more than remains; the
--                                    approver or refuser is never the requester. Append-only.
--   incentive_calc_carry (0136): from now on a 'written-off' entry is accepted only with an approved write-off naming it
--     (a constraint trigger checked at commit). Entries recorded before 0141 are left exactly as they are.
--
-- No existing row is changed. RLS on, no policies, REST roles revoked. Safe to re-run.

CREATE TABLE IF NOT EXISTS "incentive_calc_carry_writeoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "request_id" uuid REFERENCES "incentive_calc_carry_writeoffs"("id") ON DELETE RESTRICT,
  "lot_id" uuid NOT NULL REFERENCES "incentive_calc_carry"("id") ON DELETE RESTRICT,
  "result_carry_id" uuid REFERENCES "incentive_calc_carry"("id") ON DELETE RESTRICT,
  "employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "employee_name" text NOT NULL,
  "amount_paise" bigint NOT NULL,
  "reason" text NOT NULL,
  "created_by_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incentive_calc_carry_writeoffs_kind_check" CHECK ("kind" IN ('request', 'approve', 'refuse') AND (("kind" = 'request') = ("request_id" IS NULL)) AND (("kind" = 'approve') = ("result_carry_id" IS NOT NULL))),
  CONSTRAINT "incentive_calc_carry_writeoffs_amount_check" CHECK ("amount_paise" > 0),
  CONSTRAINT "incentive_calc_carry_writeoffs_text_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000 AND length(btrim("created_by_name")) BETWEEN 1 AND 200 AND length(btrim("employee_name")) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_carry_writeoffs_decided_uq" ON "incentive_calc_carry_writeoffs" ("request_id") WHERE "request_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "incentive_calc_carry_writeoffs_result_uq" ON "incentive_calc_carry_writeoffs" ("result_carry_id") WHERE "result_carry_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "incentive_calc_carry_writeoffs_lot_idx" ON "incentive_calc_carry_writeoffs" ("lot_id", "created_at");

CREATE OR REPLACE FUNCTION "incentive_calc_carry_writeoffs_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lot record;
  r record;
  w record;
  remaining bigint;
BEGIN
  -- The same lock as the ledger's own check (0136), so a payout using this lot can't interleave.
  PERFORM pg_advisory_xact_lock(hashtext('incentive_calc_carry'), hashtext(NEW."lot_id"::text));
  SELECT * INTO lot FROM "incentive_calc_carry" x WHERE x."id" = NEW."lot_id";
  IF lot IS NULL OR lot."kind" <> 'held' OR lot."employee_id" IS DISTINCT FROM NEW."employee_id" THEN
    RAISE EXCEPTION 'A carry-forward write-off names a held balance, and its salesperson' USING ERRCODE = 'check_violation';
  END IF;
  SELECT lot."amount_paise" + coalesce(sum(c."amount_paise"), 0) INTO remaining FROM "incentive_calc_carry" c WHERE c."lot_id" = NEW."lot_id";
  IF NEW."kind" = 'request' THEN
    IF NEW."amount_paise" > remaining THEN
      RAISE EXCEPTION 'A write-off never exceeds what remains of the balance: % paise asked, % remain', NEW."amount_paise", remaining USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "incentive_calc_carry_writeoffs" q WHERE q."lot_id" = NEW."lot_id" AND q."kind" = 'request'
               AND NOT EXISTS (SELECT 1 FROM "incentive_calc_carry_writeoffs" d WHERE d."request_id" = q."id")) THEN
      RAISE EXCEPTION 'A write-off of this balance already awaits its second approval' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO r FROM "incentive_calc_carry_writeoffs" q WHERE q."id" = NEW."request_id";
    IF r IS NULL OR r."kind" <> 'request' OR r."lot_id" <> NEW."lot_id" OR r."amount_paise" <> NEW."amount_paise" THEN
      RAISE EXCEPTION 'A write-off is approved or refused against its own request, for its amount' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."created_by_id" IS NULL OR NEW."created_by_id" IS NOT DISTINCT FROM r."created_by_id" THEN
      RAISE EXCEPTION 'A second person approves or refuses a write-off, never whoever requested it' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."kind" = 'approve' THEN
      SELECT * INTO w FROM "incentive_calc_carry" x WHERE x."id" = NEW."result_carry_id";
      IF w IS NULL OR w."kind" <> 'written-off' OR w."lot_id" <> NEW."lot_id" OR w."amount_paise" <> -NEW."amount_paise" OR w."created_by_id" IS DISTINCT FROM NEW."created_by_id" THEN
        RAISE EXCEPTION 'An approved write-off records exactly its amount against its balance, by the approver' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_carry_writeoffs_insert" ON "incentive_calc_carry_writeoffs";
CREATE TRIGGER "incentive_calc_carry_writeoffs_insert" BEFORE INSERT ON "incentive_calc_carry_writeoffs" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_carry_writeoffs_check"();
DROP TRIGGER IF EXISTS "incentive_calc_carry_writeoffs_no_change" ON "incentive_calc_carry_writeoffs";
CREATE TRIGGER "incentive_calc_carry_writeoffs_no_change" BEFORE UPDATE OR DELETE ON "incentive_calc_carry_writeoffs" FOR EACH ROW EXECUTE FUNCTION "incentive_calc_append_only"('employee_id', 'created_by_id');

-- From now on, a ledger write-off exists only with an approved two-person write-off naming it (checked at commit, so the
-- ledger entry and its approval are written in the same transaction, in either order).
CREATE OR REPLACE FUNCTION "incentive_calc_carry_writeoff_approved"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" = 'written-off' AND NOT EXISTS (SELECT 1 FROM "incentive_calc_carry_writeoffs" a WHERE a."kind" = 'approve' AND a."result_carry_id" = NEW."id") THEN
    RAISE EXCEPTION 'A carried-forward balance is written off only with a second person''s approval' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS "incentive_calc_carry_writeoff_approved" ON "incentive_calc_carry";
CREATE CONSTRAINT TRIGGER "incentive_calc_carry_writeoff_approved" AFTER INSERT ON "incentive_calc_carry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "incentive_calc_carry_writeoff_approved"();

-- ── descriptions ──────────────────────────────────────────────────────────────
COMMENT ON TABLE "incentive_calc_carry_writeoffs" IS 'A two-person write-off of a carried-forward balance: a request (amount and reason), then a second person''s approval (which records the ledger''s written-off entry) or refusal, each with a reason. Append-only.';

-- ── security ──────────────────────────────────────────────────────────────────
ALTER TABLE "incentive_calc_carry_writeoffs" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.incentive_calc_carry_writeoffs FROM %I', r);
    END IF;
  END LOOP;
END
$$;
