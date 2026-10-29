import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite) for the Reason for Escalation: migration 0115 + the
// 0118 file prepared for review, the real server actions, the real permission-matrix resolution
// and the reviewers' list. Nothing here can reach a shared or production database; only the
// session is mocked, with made-up test accounts (no real names or addresses).
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, claims: null as null | { email?: string; email_verified?: boolean } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/session", () => ({ readSession: async () => h.claims }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

const sqlOf = (n: string) => readFileSync(resolve(__dirname, "../../db/migrations", n), "utf8");
const M0115 = sqlOf("0115_collection_review.sql");
const M0118 = sqlOf("0118_collection_escalation_reason.sql");

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let tracker: typeof import("@/app/(forms-module)/forms/collection/actions");
let review: typeof import("@/app/(forms-module)/forms/collection/commitments/actions");
let q: typeof import("@/lib/queries/collection-review");
let cap: typeof import("@/lib/auth/capability");
const ids = { raiser: "", reviewer: "", plain: "", denied: "", alpha: "", beta: "", gamma: "", legacyEscalation: "" };
const people: Record<"raiser" | "reviewer" | "plain" | "denied", { name: string; email: string; admin: boolean }> = {
  raiser: { name: "Asha Rao", email: "raiser@example.test", admin: true },
  reviewer: { name: "Review Holder", email: "reviewer@example.test", admin: true },
  plain: { name: "Plain Staff", email: "plain@example.test", admin: false },
  denied: { name: "Denied Admin", email: "denied@example.test", admin: true },
};
const as = (k: keyof typeof people) => {
  h.me = { id: ids[k], isAdmin: people[k].admin, isActive: true, email: people[k].email, name: people[k].name };
  h.claims = { email: people[k].email, email_verified: true };
};
const escRows = async (db: Pg = pg) =>
  (await db.query<Record<string, unknown>>(`select id, company_id, status, escalated_by_id, escalated_at::text, closed_by_id, closed_at::text, reason from collection_escalations order by escalated_at, id`)).rows;

async function buildDb(withReason: boolean) {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
  });
  await made.pg.exec(M0115);
  if (withReason) await made.pg.exec(M0118);
  return made;
}

beforeAll(async () => {
  const made = await buildDb(false); // 0115 first: an escalation raised BEFORE 0118 exists
  pg = made.pg;
  h.db = made.db;
  for (const k of Object.keys(people) as (keyof typeof people)[]) {
    ids[k] = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [people[k].name, people[k].email, people[k].admin])).rows[0]!.id;
  }
  // What a super-admin's choices in the permission matrix store: the reviewer may review and close; one admin is explicitly denied escalating.
  await pg.query(
    `insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values
       ('collection.escalation.review', 'employee', $1, true), ('collection.escalation.close', 'employee', $1, true),
       ('collection.escalation.create', 'employee', $2, false)`,
    [ids.reviewer, ids.denied],
  );
  const co = async (name: string) => (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, 'MANGESH') returning id`, [name, name.toLowerCase()])).rows[0]!.id;
  ids.alpha = await co("Alpha Traders");
  ids.beta = await co("Beta Corp");
  ids.gamma = await co("Gamma Ltd");
  ids.legacyEscalation = (await pg.query<{ id: string }>(`insert into collection_escalations (company_id, escalated_by_id, escalated_at) values ($1, $2, '2026-10-20T05:00:00Z') returning id`, [ids.gamma, ids.raiser])).rows[0]!.id;
  tracker = await import("@/app/(forms-module)/forms/collection/actions");
  review = await import("@/app/(forms-module)/forms/collection/commitments/actions");
  q = await import("@/lib/queries/collection-review");
  cap = await import("@/lib/auth/capability");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("migration 0118 (prepared for review)", () => {
  it("adds the column without changing the existing escalation, and can be re-run", async () => {
    const before = (await pg.query(`select id, company_id, status, escalated_by_id, escalated_at, closed_by_id, closed_at from collection_escalations`)).rows;
    await pg.exec(M0118);
    await pg.exec(M0118); // safe to re-run
    expect((await pg.query(`select id, company_id, status, escalated_by_id, escalated_at, closed_by_id, closed_at from collection_escalations`)).rows).toEqual(before);
    const legacy = (await pg.query<{ reason: string | null }>(`select reason from collection_escalations where id = $1`, [ids.legacyEscalation])).rows[0]!;
    expect(legacy.reason).toBeNull(); // nothing invented for an older escalation
    const col = (await pg.query<{ data_type: string; is_nullable: string }>(`select data_type, is_nullable from information_schema.columns where table_name = 'collection_escalations' and column_name = 'reason'`)).rows;
    expect(col).toEqual([{ data_type: "text", is_nullable: "YES" }]);
    expect((await pg.query(`select 1 from pg_constraint where conname = 'collection_escalations_reason_check'`)).rows).toHaveLength(1);
  });

  it("the database itself refuses a blank or over-long reason (defence in depth), and still accepts NULL", async () => {
    await expect(pg.query(`insert into collection_escalations (company_id, reason) values ($1, '   ')`, [ids.beta])).rejects.toThrow(/reason_check/);
    await expect(pg.query(`insert into collection_escalations (company_id, reason) values ($1, E'\\n\\t')`, [ids.beta])).rejects.toThrow(/reason_check/);
    await expect(pg.query(`insert into collection_escalations (company_id, reason) values ($1, repeat('x', 1001))`, [ids.beta])).rejects.toThrow(/reason_check/);
    await pg.exec(`begin`);
    try {
      await pg.query(`insert into collection_escalations (company_id, reason) values ($1, repeat('x', 1000))`, [ids.beta]);
      await pg.query(`insert into collection_escalations (company_id, status, closed_at, reason) values ($1, 'closed', now(), null)`, [ids.beta]);
    } finally {
      await pg.exec(`rollback`);
    }
  });
});

describe("escalating with a reason (real server action)", () => {
  it("a valid reason is stored, trimmed, on THAT company's new escalation, with the session's author and the database's time", async () => {
    as("raiser");
    const t0 = Date.now();
    expect(await tracker.escalateForReview({ companyId: ids.alpha, reason: "  Customer disputes the invoice amount.\n" })).toEqual({ ok: true });
    const rows = (await escRows()).filter((r) => r.company_id === ids.alpha);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "open", escalated_by_id: ids.raiser, reason: "Customer disputes the invoice amount.", closed_by_id: null });
    expect(new Date(rows[0]!.escalated_at as string).getTime()).toBeGreaterThanOrEqual(t0 - 5_000);
  });

  it("reasons stay with their own escalation and company", async () => {
    as("raiser");
    expect(await tracker.escalateForReview({ companyId: ids.beta, reason: "Cheque bounced twice." })).toEqual({ ok: true });
    const byCompany = Object.fromEntries((await escRows()).filter((r) => r.status === "open").map((r) => [r.company_id as string, r.reason]));
    expect(byCompany).toEqual({ [ids.alpha]: "Customer disputes the invoice amount.", [ids.beta]: "Cheque bounced twice.", [ids.gamma]: null });
  });

  it("the server rejects invalid reasons even when the dialog is bypassed — and creates nothing", async () => {
    as("raiser");
    await pg.query(`update collection_escalations set status = 'closed', closed_at = now(), closed_by_id = $1 where company_id = $2 and status = 'open'`, [ids.reviewer, ids.beta]); // test DB only: free Beta for a new escalation
    const before = await escRows();
    for (const bad of [{}, { reason: "" }, { reason: "    " }, { reason: "\n\t" }, { reason: "x".repeat(1001) }, { reason: 7 }, { reason: null }]) {
      const res = await tracker.escalateForReview({ companyId: ids.beta, ...bad });
      expect(res.ok).toBe(false);
    }
    // nor can the author or time be supplied
    expect((await tracker.escalateForReview({ companyId: ids.beta, reason: "ok", escalatedById: ids.reviewer })).ok).toBe(false);
    expect((await tracker.escalateForReview({ companyId: ids.beta, reason: "ok", escalatedAt: "2020-01-01" })).ok).toBe(false);
    expect(await escRows()).toEqual(before);
  });

  it("people without collection.escalation.create cannot escalate: signed out, non-admin, and an admin explicitly denied", async () => {
    const before = await escRows();
    h.me = null;
    h.claims = null;
    await expect(tracker.escalateForReview({ companyId: ids.beta, reason: "x" })).rejects.toThrow("Forbidden");
    as("plain");
    await expect(tracker.escalateForReview({ companyId: ids.beta, reason: "x" })).rejects.toThrow("Forbidden");
    as("denied");
    await expect(tracker.escalateForReview({ companyId: ids.beta, reason: "x" })).rejects.toThrow("Forbidden");
    expect(await escRows()).toEqual(before);
  });
});

describe("the reviewers' list (collection.escalation.review)", () => {
  it("a holder of the grant sees every open escalation with its company, collection person, author, time and reason", async () => {
    as("reviewer");
    const proof = await cap.requireCollectionCapability("collection.escalation.review");
    const list = await q.listOpenEscalationsForReview(proof);
    expect(list).toMatchObject({ storageReady: true, reasonStorageReady: true });
    expect(list.rows.map((r) => [r.companyName, r.collectionPerson, r.escalatedByName, r.reason])).toEqual([
      ["Gamma Ltd", "MANGESH", "Asha Rao", null],
      ["Alpha Traders", "MANGESH", "Asha Rao", "Customer disputes the invoice amount."],
    ]);
    expect(list.rows.every((r) => r.escalatedAt instanceof Date)).toBe(true);
  });

  it("people without the grant cannot review — including an admin who may escalate", async () => {
    as("raiser");
    await expect(cap.requireCollectionCapability("collection.escalation.review")).rejects.toThrow("Forbidden");
    expect(await cap.getCollectionCapability("collection.escalation.review")).toBeNull();
    as("plain");
    await expect(cap.requireCollectionCapability("collection.escalation.review")).rejects.toThrow("Forbidden");
  });

  it("closing still works, needs collection.escalation.close, and keeps the reason and the escalation fields", async () => {
    const alpha = (await escRows()).find((r) => r.company_id === ids.alpha && r.status === "open")!;
    as("raiser");
    await expect(review.closeEscalation({ escalationId: alpha.id })).rejects.toThrow("Forbidden");
    as("reviewer");
    expect(await review.closeEscalation({ escalationId: alpha.id })).toEqual({ ok: true });
    const after = (await escRows()).find((r) => r.id === alpha.id)!;
    expect(after).toMatchObject({ status: "closed", closed_by_id: ids.reviewer, reason: alpha.reason, escalated_by_id: alpha.escalated_by_id, escalated_at: alpha.escalated_at });
  });
});

describe("before 0118 is installed", () => {
  it("escalating says the reason can't be stored yet and creates nothing; the reviewers' list still works, without reasons", async () => {
    const old = await buildDb(false);
    const prev = h.db;
    try {
      h.db = old.db;
      const emp = (await old.pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('Asha Rao', 'raiser@example.test', 'both', true) returning id`)).rows[0]!.id;
      const rv = (await old.pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ('Review Holder', 'reviewer@example.test', 'both', true) returning id`)).rows[0]!.id;
      await old.pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.escalation.review', 'employee', $1, true)`, [rv]);
      const company = (await old.pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key) values ('Alpha Traders', 'alpha traders') returning id`)).rows[0]!.id;
      await old.pg.query(`insert into collection_escalations (company_id, escalated_by_id) values ($1, $2)`, [company, emp]);
      await old.pg.query(`insert into collection_master_companies (company_name, name_key) values ('Beta Corp', 'beta corp')`);
      const beta = (await old.pg.query<{ id: string }>(`select id from collection_master_companies where name_key = 'beta corp'`)).rows[0]!.id;

      h.me = { id: emp, isAdmin: true, isActive: true, email: "raiser@example.test", name: "Asha Rao" };
      h.claims = { email: "raiser@example.test", email_verified: true };
      const rowsNow = async () => (await old.pg.query(`select id, company_id, status, escalated_by_id, escalated_at from collection_escalations order by id`)).rows; // no reason column here
      const before = await rowsNow();
      expect(await tracker.escalateForReview({ companyId: beta, reason: "Valid reason" })).toEqual({ ok: false, error: "Escalation reasons can't be stored yet (migration 0118 is pending), so nothing was escalated." });
      expect(await rowsNow()).toEqual(before);

      h.me = { id: rv, isAdmin: true, isActive: true, email: "reviewer@example.test", name: "Review Holder" };
      h.claims = { email: "reviewer@example.test", email_verified: true };
      const list = await q.listOpenEscalationsForReview(await cap.requireCollectionCapability("collection.escalation.review"));
      expect(list).toMatchObject({ storageReady: true, reasonStorageReady: false });
      expect(list.rows.map((r) => [r.companyName, r.reason])).toEqual([["Alpha Traders", null]]);
    } finally {
      h.db = prev;
      await old.pg.close();
    }
  }, 120_000);
});
