import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; Collection Master + escalation tables from migrations 0112, 0115 and 0118
// themselves) for the salesperson scorecards' escalation figures: each escalation counted once, attributed to the
// company's current Sales Coordinator, "resolved" only when CLOSED by a holder of collection.escalation.review (resolved
// from the real grants — nobody named in code). Plus the outstanding rule. Made-up companies and people only.
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
vi.mock("@/lib/auth/current", () => ({ getCurrentEmployee: async () => null, requireAdmin: async () => { throw new Error("Forbidden"); } }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import type { CapabilityProof } from "@/lib/auth/capability";
import { scorecardFor } from "@/lib/collections/scorecards";

const sqlOf = (n: string) => readFileSync(resolve(__dirname, "../../db/migrations", n), "utf8");
type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let q: typeof import("@/lib/queries/collection-scorecards");
const PROOF = { employeeId: "x", capability: "collection.view" } as unknown as CapabilityProof<"collection.view">;
const E: Record<string, string> = {};
const CO: Record<string, string> = {};

async function person(key: string, admin = true) {
  E[key] = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [key, `${key}@example.test`, admin])).rows[0]!.id;
}
async function company(key: string, label: string | null) {
  CO[key] = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3) returning id`, [key, key.toLowerCase(), label])).rows[0]!.id;
}
async function escalation(co: string, status: "open" | "closed", closer: string | null = null, by = "staff") {
  await pg.query(
    `insert into collection_escalations (company_id, status, escalated_by_id, escalated_at, closed_by_id, closed_at, reason) values ($1, $2, $3, now() - interval '2 days', $4, $5, 'test')`,
    [CO[co], status, E[by], closer ? E[closer] : null, status === "closed" ? new Date() : null],
  );
}

beforeAll(async () => {
  const made = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants });
  pg = made.pg;
  h.db = made.db;
  for (const m of ["0112_collection_master.sql", "0115_collection_review.sql", "0118_collection_escalation_reason.sql"]) await pg.exec(sqlOf(m));
  for (const p of ["reviewer", "closerAdmin", "staff", "leaver"]) await person(p);
  // The reviewer is whoever holds collection.escalation.review (an explicit grant, as the permission matrix stores it).
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.escalation.review', 'employee', $1, true)`, [E.reviewer]);
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.escalation.close', 'employee', $1, true)`, [E.closerAdmin]);

  await company("Alpha", "BK");
  await company("Beta", "BK");
  await company("Gamma", "SV");
  await company("Delta", null);
  // BK: Alpha — 2 closed by the reviewer, 1 closed by a non-reviewer, 1 open; Beta — 1 closed by an employee later removed.
  await escalation("Alpha", "closed", "reviewer");
  await escalation("Alpha", "closed", "reviewer");
  await escalation("Alpha", "closed", "closerAdmin");
  await escalation("Alpha", "open");
  await escalation("Beta", "closed", "leaver");
  await pg.query(`delete from employees where id = $1`, [E.leaver]); // closed_by_id → NULL (ON DELETE SET NULL): closer unknown
  // SV: Gamma — 1 closed by the reviewer. Unassigned: Delta — 1 open.
  await escalation("Gamma", "closed", "reviewer");
  await escalation("Delta", "open");
  q = await import("@/lib/queries/collection-scorecards");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

const forLabel = (label: string) => q.escalationCountsForSalesperson(PROOF, label);

describe("escalation figures for ONE salesperson", () => {
  it("counts that salesperson's escalation records once each, and 'resolved' only when closed by the reviewer", async () => {
    expect(await forLabel("BK")).toEqual({ escalated: 5, resolvedByReviewer: 2 }); // open, non-reviewer and unknown closers excluded
    expect(await forLabel("SV")).toEqual({ escalated: 1, resolvedByReviewer: 1 });
    expect(await forLabel("Nobody")).toEqual({ escalated: 0, resolvedByReviewer: 0 });
  });

  it("never includes another salesperson's or an unassigned company's escalations", async () => {
    const all = (await pg.query<{ n: number }>(`select count(*)::int n from collection_escalations`)).rows[0]!.n;
    const bk = await forLabel("BK");
    const sv = await forLabel("SV");
    expect(bk.escalated + sv.escalated).toBe(all - 1); // the one left is Delta's (unassigned)
  });

  it("follows the grant, not a name: revoking it removes the resolved counts; granting the other closer adds theirs", async () => {
    await pg.query(`update field_permission_grants set allowed = false where field_key = 'collection.escalation.review' and subject_id = $1`, [E.reviewer]);
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.escalation.review', 'employee', $1, true)`, [E.closerAdmin]);
    try {
      expect(await forLabel("BK")).toEqual({ escalated: 5, resolvedByReviewer: 1 });
      expect(await forLabel("SV")).toEqual({ escalated: 1, resolvedByReviewer: 0 });
    } finally {
      await pg.query(`update field_permission_grants set allowed = true where field_key = 'collection.escalation.review' and subject_id = $1`, [E.reviewer]);
      await pg.query(`delete from field_permission_grants where field_key = 'collection.escalation.review' and subject_id = $1`, [E.closerAdmin]);
    }
  });

  it("a reassigned company's escalations move with it (attribution is the CURRENT assignment)", async () => {
    await pg.query(`update collection_master_companies set coordinator_label = 'SV' where id = $1`, [CO.Beta]);
    try {
      expect(await forLabel("BK")).toEqual({ escalated: 4, resolvedByReviewer: 2 });
      expect(await forLabel("SV")).toEqual({ escalated: 2, resolvedByReviewer: 1 });
    } finally {
      await pg.query(`update collection_master_companies set coordinator_label = 'BK' where id = $1`, [CO.Beta]);
    }
  });

  it("a new escalation after a closed one is a new record: the earlier resolution still counts", async () => {
    await escalation("Gamma", "open");
    expect(await forLabel("SV")).toEqual({ escalated: 2, resolvedByReviewer: 1 });
  });

  it("missing escalation storage reads as no escalations", async () => {
    await pg.exec(`alter table collection_escalations rename to collection_escalations_hidden`);
    try {
      expect(await forLabel("BK")).toEqual({ escalated: 0, resolvedByReviewer: 0 });
    } finally {
      await pg.exec(`alter table collection_escalations_hidden rename to collection_escalations`);
    }
  });
});

describe("the salesperson's card from real counts", () => {
  it("only their companies; outstanding 'not configured' with no approved source", async () => {
    const parties = [
      { masterId: CO.Alpha, coordinatorLabel: "BK", outstanding: null },
      { masterId: CO.Beta, coordinatorLabel: "BK", outstanding: null },
      { masterId: CO.Gamma, coordinatorLabel: "SV", outstanding: null },
      { masterId: CO.Delta, coordinatorLabel: null, outstanding: null },
    ];
    expect(scorecardFor("BK", parties, { approved: false }, await forLabel("BK"))).toEqual({
      salesperson: "BK", clients: 2, outstanding: { status: "not-configured" }, escalations: { status: "ok", escalated: 5, resolvedByReviewer: 2 },
    });
  });
});
