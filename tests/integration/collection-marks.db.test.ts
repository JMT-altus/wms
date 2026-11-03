import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; the tables from migrations 0112, 0117, 0119 and 0125 themselves) for the
// Tracker's MARK AS PRIORITY / COLLECTION DONE marks: an append-only episode per mark with who and when, at most one
// active episode per kind (the database refuses a second), reversing recorded rather than deleted, the precedence
// through the real rows, and the marks untouched by a Master update, a balance upload and a closure. Made-up
// companies and people only.
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
import type { MarkProof } from "@/lib/queries/collection-marks";
import { markStateOf } from "@/lib/collections/marks";
import { buildRows, sortRows } from "@/lib/collections/derive";
import type { CollectionParty } from "@/lib/collections/source";

const sqlOf = (n: string) => readFileSync(resolve(__dirname, "../../db/migrations", n), "utf8");
type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let q: typeof import("@/lib/queries/collection-marks");
const E = { asha: "", ravi: "" };
const CO = { Alpha: "", Bravo: "", Charlie: "" };
const proof = (who: keyof typeof E) => ({ employeeId: E[who], capability: "collection.priority.set" }) as unknown as MarkProof;

beforeAll(async () => {
  const made = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters });
  pg = made.pg;
  h.db = made.db;
  for (const m of ["0112_collection_master.sql", "0117_collection_balances.sql", "0119_collection_closures.sql", "0125_collection_company_marks.sql"]) await pg.exec(sqlOf(m));
  for (const p of ["asha", "ravi"] as const) {
    E[p] = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [p, `${p}@example.test`])).rows[0]!.id;
  }
  for (const [name, label] of [
    ["Alpha", "BK"],
    ["Bravo", "BK"],
    ["Charlie", "SV"],
  ] as const) {
    CO[name] = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3) returning id`, [name, name.toLowerCase(), label])).rows[0]!.id;
  }
  q = await import("@/lib/queries/collection-marks");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

const episodes = async (co: keyof typeof CO) =>
  (await pg.query<{ kind: string; set_by_id: string | null; cleared_by_id: string | null; cleared_at: Date | null }>(`select kind, set_by_id, cleared_by_id, cleared_at from collection_company_marks where company_id = $1 order by set_at, kind`, [CO[co]])).rows;

describe("mark episodes", () => {
  it("marking starts an episode with who and when; a second mark of the same kind is refused by the database, not written twice", async () => {
    expect(await q.setCompanyMark(proof("asha"), CO.Alpha, "priority")).toBe("set");
    expect(await q.setCompanyMark(proof("ravi"), CO.Alpha, "priority")).toBe("already");
    expect(await episodes("Alpha")).toEqual([{ kind: "priority", set_by_id: E.asha, cleared_by_id: null, cleared_at: null }]);
    const { storageReady, byCompany } = await q.activeMarks([CO.Alpha, CO.Bravo]);
    expect(storageReady).toBe(true);
    expect(byCompany.get(CO.Alpha)).toMatchObject({ priority: { setByName: "asha" }, done: null });
    expect(byCompany.get(CO.Alpha)!.priority!.setAt).toBeInstanceOf(Date);
    expect(byCompany.has(CO.Bravo)).toBe(false);
  });

  it("reversing records who and when and keeps the row; reversing again does nothing; marking again is a NEW episode", async () => {
    expect(await q.clearCompanyMark(proof("ravi"), CO.Alpha, "priority")).toBe("cleared");
    expect(await q.clearCompanyMark(proof("ravi"), CO.Alpha, "priority")).toBe("none");
    expect((await q.activeMarks([CO.Alpha])).byCompany.has(CO.Alpha)).toBe(false);
    expect(await q.setCompanyMark(proof("asha"), CO.Alpha, "priority")).toBe("set");
    const rows = await episodes("Alpha");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "priority", set_by_id: E.asha, cleared_by_id: E.ravi });
    expect(rows[0]!.cleared_at).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ kind: "priority", set_by_id: E.asha, cleared_by_id: null, cleared_at: null });
  });

  it("priority and done are separate episodes; done takes precedence, and undoing it brings priority back", async () => {
    expect(await q.setCompanyMark(proof("asha"), CO.Alpha, "done")).toBe("set");
    let marks = (await q.activeMarks([CO.Alpha])).byCompany.get(CO.Alpha);
    expect(marks!.priority).not.toBeNull();
    expect(marks!.done).not.toBeNull();
    expect(markStateOf(marks)).toBe("done");
    expect(await q.clearCompanyMark(proof("asha"), CO.Alpha, "done")).toBe("cleared");
    marks = (await q.activeMarks([CO.Alpha])).byCompany.get(CO.Alpha);
    expect(markStateOf(marks)).toBe("priority");
  });

  it("only the two kinds exist", async () => {
    await expect(pg.query(`insert into collection_company_marks (company_id, kind) values ($1, 'later')`, [CO.Bravo])).rejects.toThrow(/kind_check/);
  });

  it("a marked company cannot be deleted from the Master (the history stays)", async () => {
    await expect(pg.query(`delete from collection_master_companies where id = $1`, [CO.Alpha])).rejects.toThrow(/violates foreign key/);
  });
});

describe("marks are a person's decision only", () => {
  it("a Master update, a balance upload and a closure leave the marks exactly as they were", async () => {
    await q.setCompanyMark(proof("asha"), CO.Bravo, "done");
    const before = await episodes("Bravo");
    // A Collection Master re-import updates companies in place.
    await pg.query(`update collection_master_companies set coordinator_label = 'SV', updated_at = now() where id = $1`, [CO.Bravo]);
    // A Bulk Upload of balances adds a snapshot and lines (₹0 / ₹0 for Bravo — the Collection Logs rule).
    const snap = (await pg.query<{ id: string }>(`insert into collection_balance_snapshots (imported_total_debit, imported_total_credit) values (0, 0) returning id`)).rows[0]!.id;
    await pg.query(`insert into collection_balance_lines (snapshot_id, company_id, source_name, source_row, debit, credit) values ($1, $2, 'Bravo', 2, 0, 0)`, [snap, CO.Bravo]);
    // …and the closure that puts Bravo in Collection Logs.
    await pg.query(`insert into collection_closures (company_id, close_reason, close_source_key, close_source_ref, final_outstanding, final_debit, final_credit) values ($1, 'outstanding_zero', 'balances', $2, 0, 0, 0)`, [CO.Bravo, snap]);
    expect(await episodes("Bravo")).toEqual(before);
    expect(markStateOf((await q.activeMarks([CO.Bravo])).byCompany.get(CO.Bravo))).toBe("done");
  });
});

describe("the Tracker order from real marks", () => {
  it("priority on top, pending in the middle, done at the bottom", async () => {
    const { byCompany } = await q.activeMarks();
    const parties: CollectionParty[] = (["Alpha", "Bravo", "Charlie"] as const).map((n) => ({
      partyName: n, debit: null, credit: null, outstanding: null, collectionPerson: "BK", coordinatorLabel: "BK", masterId: CO[n], transactions: [],
    }));
    const rows = buildRows(parties, []).map((r) => ({ ...r, marks: byCompany.get(r.masterId!) ?? null }));
    expect(sortRows(rows, "party", "desc").map((r) => r.partyName)).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  it("before migration 0125 the Tracker reads no marks and says so", async () => {
    await pg.exec(`alter table collection_company_marks rename to collection_company_marks_hidden`);
    try {
      expect(await q.activeMarks([CO.Alpha])).toEqual({ storageReady: false, byCompany: new Map() });
      await expect(q.setCompanyMark(proof("asha"), CO.Alpha, "done")).rejects.toMatchObject({ cause: { code: "42P01" } });
    } finally {
      await pg.exec(`alter table collection_company_marks_hidden rename to collection_company_marks`);
    }
  });
});
