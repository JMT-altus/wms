import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests for migration 0115 (confirmations + escalations) and the
// escalation reason of migration 0118 (prepared for review) on an in-memory
// PGlite database built from db/schema.ts plus the migrations' own SQL. No
// shared or production database can be reached.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import type { CapabilityProof } from "@/lib/auth/capability";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let q: typeof import("@/lib/queries/collection-review");
let ACTOR = "";
let OWNER = "";
let ALPHA = "";
let BETA = "";
// The queries take capability proofs (what requireCapability returns after checking a grant).
const proof = <K extends "collection.confirmation.set" | "collection.escalation.create" | "collection.escalation.review" | "collection.escalation.close">(employeeId: string, capability: K) =>
  ({ employeeId, capability }) as CapabilityProof<K>;
const reviewer = () => proof(OWNER, "collection.escalation.review");
const closer = () => proof(OWNER, "collection.escalation.close");

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0115_collection_review.sql"), "utf8"));
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0118_collection_escalation_reason.sql"), "utf8"));
  const emp = async (name: string) =>
    (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ($1, $2, 'both') returning id`, [name, `${name.toLowerCase()}@example.test`])).rows[0]!.id;
  ACTOR = await emp("Asha");
  OWNER = await emp("Mihir");
  const co = async (name: string, person: string | null) =>
    (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3) returning id`, [name, name.toLowerCase().replace(/[^a-z0-9]/g, ""), person])).rows[0]!.id;
  ALPHA = await co("Alpha Traders", "MANGESH");
  BETA = await co("Beta Corp", null);
  q = await import("@/lib/queries/collection-review");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

const count = async (sql: string, p: unknown[] = []) => (await pg.query<{ n: number }>(sql, p)).rows[0]!.n;

describe("Collection Amount Confirmation", () => {
  it("starts unset (no row), then keeps an append-only history whose newest row is current", async () => {
    expect((await q.latestConfirmations([ALPHA])).byCompany.get(ALPHA)).toBeUndefined();
    await q.recordConfirmation(proof(ACTOR, "collection.confirmation.set"), ALPHA, "no");
    await new Promise((r) => setTimeout(r, 5));
    await q.recordConfirmation(proof(ACTOR, "collection.confirmation.set"), ALPHA, "yes");
    expect((await q.latestConfirmations([ALPHA])).byCompany.get(ALPHA)).toMatchObject({ value: "yes", recordedByName: "Asha" });
    expect(await count(`select count(*)::int as n from collection_amount_confirmations where company_id = $1`, [ALPHA])).toBe(2);
  });

  it("the database refuses anything but yes/no, and unknown companies", async () => {
    await expect(pg.query(`insert into collection_amount_confirmations (company_id, value) values ($1, 'maybe')`, [ALPHA])).rejects.toThrow(/value_check/);
    await expect(pg.query(`insert into collection_amount_confirmations (company_id, value) values ('00000000-0000-4000-8000-000000000000', 'yes')`)).rejects.toThrow(/foreign key/i);
  });
});

describe("escalations", () => {
  it("records who/when and snapshots the confirmation in force (unset → null)", async () => {
    const beta = await q.escalateCompany(proof(ACTOR, "collection.escalation.create"), BETA, "Customer stopped answering calls.");
    expect(beta.ok).toBe(true);
    const alpha = await q.escalateCompany(proof(ACTOR, "collection.escalation.create"), ALPHA, "Disputes the invoice amount.");
    expect(alpha.ok).toBe(true);
    const open = (await q.openEscalations()).byCompany;
    expect(open.get(BETA)).toMatchObject({ confirmationAtEscalation: null, escalatedByName: "Asha" });
    expect(open.get(ALPHA)).toMatchObject({ confirmationAtEscalation: "yes" });
  });

  it("allows only one open escalation per company — a repeat is 'already-open', not a second row", async () => {
    expect(await q.escalateCompany(proof(ACTOR, "collection.escalation.create"), ALPHA, "A second reason")).toEqual({ ok: false, reason: "already-open" });
    expect(await count(`select count(*)::int as n from collection_escalations where company_id = $1`, [ALPHA])).toBe(1);
  });

  it("the reviewers' list joins company, collection person and each escalation's own reason", async () => {
    const list = await q.listOpenEscalationsForReview(reviewer());
    expect(list.reasonStorageReady).toBe(true);
    expect(list.rows.map((r) => [r.companyName, r.collectionPerson, r.reason])).toEqual([
      ["Beta Corp", null, "Customer stopped answering calls."],
      ["Alpha Traders", "MANGESH", "Disputes the invoice amount."],
    ]);
  });

  it("closing keeps the original record, a closed one can't be closed again, and a new escalation is a NEW row", async () => {
    const before = (await pg.query<{ id: string; escalated_at: Date; escalated_by_id: string }>(`select id, escalated_at, escalated_by_id from collection_escalations where company_id = $1`, [ALPHA])).rows[0]!;
    expect(await q.closeEscalationById(closer(), before.id)).toBe(true);
    expect(await q.closeEscalationById(closer(), before.id)).toBe(false);
    const closed = (await pg.query(`select * from collection_escalations where id = $1`, [before.id])).rows[0] as Record<string, unknown>;
    expect(closed).toMatchObject({ status: "closed", closed_by_id: OWNER, escalated_by_id: ACTOR });
    expect((closed.escalated_at as Date).getTime()).toBe(new Date(before.escalated_at).getTime());

    const again = await q.escalateCompany(proof(ACTOR, "collection.escalation.create"), ALPHA, "Promised date missed again.");
    expect(again.ok).toBe(true);
    expect(again.ok && again.escalationId).not.toBe(before.id);
    expect(await count(`select count(*)::int as n from collection_escalations where company_id = $1`, [ALPHA])).toBe(2);
    expect(await count(`select count(*)::int as n from collection_escalations where company_id = $1 and status = 'open'`, [ALPHA])).toBe(1);
  });

  it("the database keeps status and closing fields consistent", async () => {
    await expect(pg.query(`insert into collection_escalations (company_id, status) values ($1, 'closed')`, [BETA])).rejects.toThrow(/closed_check/);
    await expect(pg.query(`insert into collection_escalations (company_id, status) values ($1, 'pending')`, [BETA])).rejects.toThrow(/status_check|closed_check/); // rejected by whichever check Postgres evaluates first
  });
});

describe("migrations 0115 + 0118 vs db/schema.ts, and access", () => {
  it("RLS is on for both tables", async () => {
    const r = await pg.query<{ relname: string; rls: boolean }>(`select relname, relrowsecurity as rls from pg_class where relname in ('collection_amount_confirmations','collection_escalations') order by relname`);
    expect(r.rows).toEqual([
      { relname: "collection_amount_confirmations", rls: true },
      { relname: "collection_escalations", rls: true },
    ]);
  });

  it("the schema code declares the same constraints and indexes as the SQL", async () => {
    const fromSql = async (db: typeof pg) =>
      (
        await db.query<{ name: string }>(
          `select conname as name from pg_constraint where conrelid in ('collection_amount_confirmations'::regclass, 'collection_escalations'::regclass) and contype in ('c','u')
           union select indexname from pg_indexes where tablename in ('collection_amount_confirmations','collection_escalations') and indexname not like '%_pkey'
           order by 1`,
        )
      ).rows.map((r) => r.name);
    const viaSchema = await createTestDb({
      employees: schema.employees,
      customerMasters: schema.customerMasters,
      collectionMasterImports: schema.collectionMasterImports,
      collectionMasterCompanies: schema.collectionMasterCompanies,
      collectionAmountConfirmations: schema.collectionAmountConfirmations,
      collectionEscalations: schema.collectionEscalations,
    });
    try {
      expect(await fromSql(viaSchema.pg)).toEqual(await fromSql(pg));
      const partial = await viaSchema.pg.query<{ def: string }>(`select indexdef as def from pg_indexes where indexname = 'collection_escalations_one_open_uq'`);
      expect(partial.rows[0]!.def).toMatch(/WHERE \(status = 'open'::text\)/);
    } finally {
      await viaSchema.pg.close();
    }
    // Builds a second in-memory database, so it needs more than vitest's 5 s default when the whole suite is running.
  }, 60_000);
});
