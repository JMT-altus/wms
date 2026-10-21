import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES test of the Client KYC expiry sweep on an in-memory PGlite
// database (see ./_pglite.ts) with made-up records. DATABASE_URL is forced to an
// unresolvable address and @/lib/db is the in-memory instance, so no shared or
// production database can be touched. The expiry periods come from the app's
// own constants, not from this file.
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
import { CHECKOUT_EXPIRY_MINUTES, DRAFT_EXPIRY_DAYS } from "@/lib/masters/kyc-completeness";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let sweep: typeof import("@/lib/masters/draft-sweep");

beforeAll(async () => {
  const made = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters });
  pg = made.pg;
  h.db = made.db;
  sweep = await import("@/lib/masters/draft-sweep");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

async function add(name: string, cols: string, values: string) {
  await pg.exec(`insert into customer_masters (name${cols ? `, ${cols}` : ""}) values ('${name}'${values ? `, ${values}` : ""})`);
}
async function state() {
  const r = await pg.query<{ name: string; kyc_stage: string; recycled: boolean; editing: boolean }>(
    `select name, kyc_stage, recycled_at is not null as recycled, editing_since is not null as editing from customer_masters order by name`,
  );
  return Object.fromEntries(r.rows.map((x) => [x.name, x]));
}

describe("sweepExpiredDrafts (isolated test data)", () => {
  it("recycles only expired drafts, releases only stale checkouts, and is idempotent", async () => {
    const days = DRAFT_EXPIRY_DAYS;
    const mins = CHECKOUT_EXPIRY_MINUTES;
    await add("A expired draft", "kyc_stage, draft_since", `'draft', now() - interval '${days} days' - interval '1 hour'`);
    await add("B fresh draft", "kyc_stage, draft_since", `'draft', now() - interval '${days} days' + interval '1 hour'`);
    await add("C complete", "kyc_stage, draft_since", `'complete', now() - interval '${days * 3} days'`);
    await add("D stale checkout", "kyc_stage, draft_since, editing_since", `'draft', now() - interval '1 day', now() - interval '${mins + 5} minutes'`);
    await add("E live checkout", "kyc_stage, draft_since, editing_since", `'draft', now() - interval '1 day', now() - interval '${Math.max(1, mins - 5)} minutes'`);
    await add("F already recycled", "kyc_stage, draft_since, recycled_at", `'recycled', now() - interval '${days * 2} days', now() - interval '1 day'`);

    const first = await sweep.sweepExpiredDrafts();
    expect(first).toEqual({ recycled: 1, released: 1 });
    const s = await state();
    expect(s["A expired draft"]).toMatchObject({ kyc_stage: "recycled", recycled: true });
    expect(s["B fresh draft"]).toMatchObject({ kyc_stage: "draft", recycled: false });
    expect(s["C complete"]).toMatchObject({ kyc_stage: "complete", recycled: false });
    expect(s["D stale checkout"]).toMatchObject({ kyc_stage: "draft", editing: false });
    expect(s["E live checkout"]).toMatchObject({ kyc_stage: "draft", editing: true });
    expect(s["F already recycled"]).toMatchObject({ kyc_stage: "recycled" });

    expect(await sweep.sweepExpiredDrafts()).toEqual({ recycled: 0, released: 0 });
  });

  it("the quiet variant swallows a failure instead of breaking the page", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await pg.exec(`alter table customer_masters rename to customer_masters_gone`);
    try {
      await expect(sweep.sweepExpiredDraftsQuietly()).resolves.toBeUndefined();
      expect(err).toHaveBeenCalled();
    } finally {
      await pg.exec(`alter table customer_masters_gone rename to customer_masters`);
      err.mockRestore();
    }
  });
});
