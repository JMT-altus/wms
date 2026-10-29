import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite, tables from the migration files 0110 and
// 0112 themselves) for the Collection comments audit details: the author is the
// signed-in employee from the session, the time is the database clock, both are
// stored with the comment and read back with the author's name, and a comment
// with no author on record is shown honestly. Nothing here can reach a shared or
// production database; only the session is mocked (made-up test addresses).
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, claims: null as null | { email?: string; email_verified?: boolean } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/format", async (orig) => ({ ...(await orig<typeof import("@/lib/format")>()), localDateString: () => "2026-10-27" }));
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
import { HISTORICAL_AUTHOR, UNAVAILABLE_USER_ID, commentAuthor, commentDate, commentTime } from "@/lib/collections/comment-audit";
import { followUpsByParty, partyKey } from "@/lib/collections/derive";

const sqlOf = (n: string) => readFileSync(resolve(__dirname, "../../db/migrations", n), "utf8");

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let tracker: typeof import("@/app/(forms-module)/forms/collection/actions");
let followups: typeof import("@/lib/queries/collection-followups");
const ids = { asha: "", ravi: "", plain: "", denied: "", leaver: "" };
const people: Record<keyof typeof ids, { name: string; email: string; admin: boolean }> = {
  asha: { name: "Asha Rao", email: "asha@example.test", admin: true },
  ravi: { name: "Ravi Kumar", email: "ravi@example.test", admin: true },
  plain: { name: "Plain Staff", email: "plain@example.test", admin: false },
  denied: { name: "Denied Admin", email: "denied@example.test", admin: true },
  leaver: { name: "Leaving Person", email: "leaver@example.test", admin: true },
};
const as = (k: keyof typeof ids) => {
  h.me = { id: ids[k], isAdmin: people[k].admin, isActive: true, email: people[k].email, name: people[k].name };
  h.claims = { email: people[k].email, email_verified: true };
};
const rowsNow = async () =>
  (await pg.query<{ id: string; party_name: string; note: string | null; created_by_id: string | null; created_at: string }>(
    `select id, party_name, note, created_by_id, created_at::text from collection_followups order by created_at, id`,
  )).rows;

beforeAll(async () => {
  const made = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants });
  pg = made.pg;
  h.db = made.db;
  await pg.exec(sqlOf("0110_collection_followups.sql"));
  await pg.exec(sqlOf("0112_collection_master.sql"));
  for (const k of Object.keys(ids) as (keyof typeof ids)[]) {
    ids[k] = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [people[k].name, people[k].email, people[k].admin])).rows[0]!.id;
  }
  // An explicit person-level deny of collection.followup.write (what a super-admin's "Deny" stores) — it outranks the admin bypass.
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.followup.write', 'employee', $1, false)`, [ids.denied]);
  await pg.exec(`insert into collection_master_companies (company_name, name_key) values ('Alpha Traders', 'alpha traders'), ('Beta Corp', 'beta corp')`);
  // A comment from before the author was on record (no author id), as an older row would look.
  await pg.exec(`insert into collection_followups (party_name, note, created_by_id, created_at) values ('Alpha Traders', 'Older note, author not on record', null, '2026-09-01T05:00:00Z')`);
  tracker = await import("@/app/(forms-module)/forms/collection/actions");
  followups = await import("@/lib/queries/collection-followups");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("a new comment carries the signed-in author and the server's time", () => {
  it("stores the session's employee id and a database timestamp, and reads back id + name", async () => {
    as("asha");
    const before = Date.now();
    expect(await tracker.saveFollowUp({ partyName: "Alpha Traders", note: "Customer confirmed payment will be made by Friday." })).toEqual({ ok: true });
    const after = Date.now();
    const { entries, storageReady } = await followups.listFollowUps();
    expect(storageReady).toBe(true);
    const e = entries.find((x) => x.note === "Customer confirmed payment will be made by Friday.")!;
    expect(e.createdById).toBe(ids.asha);
    expect(e.createdByName).toBe("Asha Rao");
    expect(e.createdAt).toBeInstanceOf(Date);
    expect(e.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(e.createdAt.getTime()).toBeLessThanOrEqual(after + 5_000);
    // …and it is shown as exactly what was stored
    expect(commentAuthor(e)).toEqual({ name: "Asha Rao", userId: ids.asha, known: true });
    expect(commentDate(e.createdAt)).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/);
    expect(commentTime(e.createdAt)).toMatch(/^\d{2}:\d{2} (AM|PM) IST$/);
  });

  it("the browser cannot choose the author or the time: such requests are refused and nothing is stored", async () => {
    as("ravi");
    const before = await rowsNow();
    for (const extra of [{ createdById: ids.asha }, { createdByName: "Asha Rao" }, { createdAt: "2020-01-01T00:00:00Z" }]) {
      const res = await tracker.saveFollowUp({ partyName: "Beta Corp", note: "Pretending to be Asha", ...extra });
      expect(res.ok).toBe(false);
    }
    expect(await rowsNow()).toEqual(before);
    // the honest request is stored under the person actually signed in
    expect(await tracker.saveFollowUp({ partyName: "Beta Corp", note: "Disputed invoice 114" })).toEqual({ ok: true });
    const e = (await followups.listFollowUps()).entries.find((x) => x.note === "Disputed invoice 114")!;
    expect([e.createdById, e.createdByName]).toEqual([ids.ravi, "Ravi Kumar"]);
  });
});

describe("only authorised people can add a comment (server-side)", () => {
  it("signed out, a non-admin, and an admin explicitly denied collection.followup.write are all refused; nothing is stored", async () => {
    const before = await rowsNow();
    h.me = null;
    h.claims = null;
    await expect(tracker.saveFollowUp({ partyName: "Alpha Traders", note: "x" })).rejects.toThrow("Forbidden");
    as("plain");
    await expect(tracker.saveFollowUp({ partyName: "Alpha Traders", note: "x" })).rejects.toThrow("Forbidden");
    as("denied");
    await expect(tracker.saveFollowUp({ partyName: "Alpha Traders", note: "x" })).rejects.toThrow("Forbidden");
    expect(await rowsNow()).toEqual(before);
  });
});

describe("existing comments and their companies", () => {
  it("comments stay with their own company, newest first", async () => {
    const by = followUpsByParty((await followups.listFollowUps()).entries);
    expect(by.get(partyKey("Alpha Traders"))!.map((e) => e.note)).toEqual(["Customer confirmed payment will be made by Friday.", "Older note, author not on record"]);
    expect(by.get(partyKey("Beta Corp"))!.map((e) => e.note)).toEqual(["Disputed invoice 114"]);
  });

  it("a comment with no author on record is shown honestly — never as the person viewing it", async () => {
    as("asha");
    const old = (await followups.listFollowUps()).entries.find((x) => x.note === "Older note, author not on record")!;
    expect([old.createdById, old.createdByName]).toEqual([null, null]);
    expect(commentAuthor(old)).toEqual({ name: HISTORICAL_AUTHOR, userId: UNAVAILABLE_USER_ID, known: false });
    expect(commentAuthor(old).name).not.toBe(h.me!.name);
    expect(old.createdAt.toISOString()).toBe("2026-09-01T05:00:00.000Z");
  });

  it("adding a comment changes no existing comment (text, author, time and company preserved)", async () => {
    as("ravi");
    const before = await rowsNow();
    expect(await tracker.saveFollowUp({ partyName: "Alpha Traders", note: "Follow up after Diwali" })).toEqual({ ok: true });
    const after = await rowsNow();
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((r) => before.some((b) => b.id === r.id))).toEqual(before);
  });

  it("if the author's employee record is later removed, the comment keeps its text and time and shows the fallback", async () => {
    as("leaver");
    expect(await tracker.saveFollowUp({ partyName: "Beta Corp", note: "Written by someone who later left" })).toEqual({ ok: true });
    const saved = (await followups.listFollowUps()).entries.find((x) => x.note === "Written by someone who later left")!;
    expect(saved.createdById).toBe(ids.leaver);
    await pg.query(`delete from employees where id = $1`, [ids.leaver]); // test database only: ON DELETE SET NULL clears the author id
    const after = (await followups.listFollowUps()).entries.find((x) => x.id === saved.id)!;
    expect([after.note, after.createdAt.getTime(), after.createdById, after.createdByName]).toEqual([saved.note, saved.createdAt.getTime(), null, null]);
    expect(commentAuthor(after).name).toBe(HISTORICAL_AUTHOR);
  });
});

describe("a database failure is reported safely", () => {
  it("returns a fixed message, not the database's own text, and stores nothing", async () => {
    as("asha");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await pg.exec(`alter table collection_followups add constraint test_only_reject check (note is distinct from 'boom') not valid`);
    try {
      const before = await rowsNow();
      const res = await tracker.saveFollowUp({ partyName: "Alpha Traders", note: "boom" });
      expect(res).toEqual({ ok: false, error: "The follow-up could not be saved, so nothing was changed. Please try again." });
      expect(await rowsNow()).toEqual(before);
      expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/test_only_reject|violates|collection_followups"/);
    } finally {
      await pg.exec(`alter table collection_followups drop constraint test_only_reject`);
      errSpy.mockRestore();
    }
  });
});
