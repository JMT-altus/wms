import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; collection_followups from migration 0110 itself) for deleting a comment:
// SOFT deletion recorded in employee_events — the follow-up row is never changed or removed — author-only with
// collection.view + collection.followup.write, company check, concurrent change, duplicate and failed deletes,
// and every screen's list (listFollowUps) hiding it. Only the session is mocked (made-up test addresses).
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
type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let tracker: typeof import("@/app/(forms-module)/forms/collection/actions");
let followups: typeof import("@/lib/queries/collection-followups");

const people = {
  writer: { name: "Writer One", email: "writer@example.test", admin: true },
  other: { name: "Writer Two", email: "other@example.test", admin: true },
  noWrite: { name: "No Write", email: "nowrite@example.test", admin: true },
  noView: { name: "No View", email: "noview@example.test", admin: true },
};
type Who = keyof typeof people;
const ids = {} as Record<Who, string>;
const as = (k: Who) => {
  h.me = { id: ids[k], isAdmin: people[k].admin, isActive: true, email: people[k].email, name: people[k].name };
  h.claims = { email: people[k].email, email_verified: true };
};
const C: Record<string, string> = {};
async function add(key: string, who: Who, party: string, note: string | null, at: string, date: string | null = null) {
  C[key] = (await pg.query<{ id: string }>(
    `insert into collection_followups (party_name, note, next_followup_date, created_by_id, created_at) values ($1, $2, $3, $4, $5) returning id`,
    [party, note, date, ids[who], at],
  )).rows[0]!.id;
}
const rowsFingerprint = async () =>
  (await pg.query<{ h: string; n: number }>(`select count(*)::int n, md5(string_agg(x::text, ',' order by x::text)) h from collection_followups x`)).rows[0]!;
const deleteEvents = async () =>
  (await pg.query<{ employee_id: string; actor_id: string; from_value: Record<string, unknown>; to_value: Record<string, unknown>; created_at: string }>(
    `select employee_id, actor_id, from_value, to_value, created_at::text from employee_events where event_type = 'collection_comment_deleted' order by created_at, id`,
  )).rows;
const visibleNotes = async (party: string) =>
  (await followups.listFollowUps()).entries.filter((e) => e.partyName === party && e.note).map((e) => e.note);
const del = (id: string, partyName: string, expectedNote: string) => tracker.deleteFollowUpComment({ id, partyName, expectedNote });

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants, employeeEvents: schema.employeeEvents,
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec(sqlOf("0110_collection_followups.sql"));
  for (const k of Object.keys(people) as Who[]) {
    ids[k] = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [people[k].name, people[k].email, people[k].admin])).rows[0]!.id;
  }
  const grant = (key: string, who: Who, allowed: boolean) =>
    pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, $3)`, [key, ids[who], allowed]);
  for (const k of ["writer", "other", "noWrite", "noView"] as Who[]) await grant("collection.view", k, k !== "noView");
  for (const k of ["writer", "other", "noView"] as Who[]) await grant("collection.followup.write", k, true);
  await grant("collection.followup.write", "noWrite", false);

  for (let i = 1; i <= 6; i++) await add(`a${i}`, "writer", "Alpha Traders", `Alpha note ${i}`, `2026-10-2${i}T05:00:00Z`);
  await add("aDate", "writer", "Alpha Traders", "Alpha note with a date", "2026-10-19T05:00:00Z", "2026-11-30");
  await add("b1", "writer", "Beta Corp", "Beta note 1", "2026-10-20T05:00:00Z");
  await add("o1", "other", "Alpha Traders", "Other's note", "2026-10-18T05:00:00Z");
  await pg.exec(`
    create table test_faults (kind text primary key);
    create function test_fail_audit() returns trigger language plpgsql as $$
    begin if exists (select 1 from test_faults where kind = 'audit') then raise exception 'simulated audit failure'; end if; return new; end $$;
    create trigger test_fail_audit before insert on employee_events for each row execute function test_fail_audit();`);
  tracker = await import("@/app/(forms-module)/forms/collection/actions");
  followups = await import("@/lib/queries/collection-followups");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec(`delete from test_faults`);
  vi.restoreAllMocks();
});

describe("deleting your own comment (soft)", () => {
  it("hides it on every screen's list and the count drops; the stored row is untouched; the audit event keeps the full original", async () => {
    as("writer");
    expect(await visibleNotes("Alpha Traders")).toHaveLength(8);
    const rowsBefore = await rowsFingerprint();
    expect(await del(C.a6!, "Alpha Traders", "Alpha note 6")).toEqual({ ok: true });
    expect(await visibleNotes("Alpha Traders")).toHaveLength(7);
    expect(await visibleNotes("Alpha Traders")).not.toContain("Alpha note 6");
    expect(await rowsFingerprint()).toEqual(rowsBefore); // nothing in collection_followups changed or disappeared
    const ev = await deleteEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      employee_id: ids.writer, actor_id: ids.writer,
      from_value: { followupId: C.a6, partyName: "Alpha Traders", note: "Alpha note 6", nextFollowupDate: null, createdById: ids.writer, createdAt: "2026-10-26T05:00:00.000Z" },
      to_value: { followupId: C.a6, deleted: true },
    });
  });

  it("a follow-up that also set a next date keeps the date; only the comment is hidden", async () => {
    as("writer");
    expect(await del(C.aDate!, "Alpha Traders", "Alpha note with a date")).toEqual({ ok: true });
    const entry = (await followups.listFollowUps()).entries.find((e) => e.id === C.aDate)!;
    expect(entry).toMatchObject({ note: null, nextFollowupDate: "2026-11-30" });
  });

  it("deleting twice (double click, retry) records ONE deletion", async () => {
    as("writer");
    const before = (await deleteEvents()).length;
    expect(await del(C.a5!, "Alpha Traders", "Alpha note 5")).toEqual({ ok: true });
    expect(await del(C.a5!, "Alpha Traders", "Alpha note 5")).toEqual({ ok: true });
    expect((await deleteEvents()).length).toBe(before + 1);
  });

  it("a deleted comment can't be edited afterwards", async () => {
    as("writer");
    expect(await tracker.editFollowUpComment({ id: C.a5, expectedNote: "Alpha note 5", note: "Bring it back" })).toEqual({
      ok: false, error: "That comment has been deleted, so it can't be edited.",
    });
    expect(await visibleNotes("Alpha Traders")).not.toContain("Bring it back");
  });
});

describe("refused deletions change nothing", () => {
  let rows: Awaited<ReturnType<typeof rowsFingerprint>>;
  let events: number;
  beforeEach(async () => {
    rows = await rowsFingerprint();
    events = (await deleteEvents()).length;
  });
  const unchanged = async () => {
    expect(await rowsFingerprint()).toEqual(rows);
    expect((await deleteEvents()).length).toBe(events);
  };

  it("someone else's comment — even for a holder of the write permission", async () => {
    as("other");
    expect(await del(C.a4!, "Alpha Traders", "Alpha note 4")).toEqual({ ok: false, error: "You can only delete your own comments." });
    await unchanged();
  });

  it("a comment sent as belonging to ANOTHER company", async () => {
    as("writer");
    expect(await del(C.b1!, "Alpha Traders", "Beta note 1")).toEqual({ ok: false, error: "That comment doesn't belong to this company, so nothing was deleted." });
    expect(await visibleNotes("Beta Corp")).toEqual(["Beta note 1"]);
    await unchanged();
  });

  it("without collection.followup.write, or without collection.view (the Tracker), or signed out: Forbidden before anything is read", async () => {
    for (const who of ["noWrite", "noView"] as Who[]) {
      as(who);
      await expect(del(C.a4!, "Alpha Traders", "Alpha note 4")).rejects.toThrow(/Forbidden/);
    }
    h.me = null;
    await expect(del(C.a4!, "Alpha Traders", "Alpha note 4")).rejects.toThrow(/Forbidden/);
    await unchanged();
  });

  it("text changed since it was shown (concurrent edit) — nothing deleted", async () => {
    as("writer");
    const r = await del(C.a4!, "Alpha Traders", "Older text");
    expect(!r.ok && r.error).toMatch(/changed after you opened it/);
    await unchanged();
  });

  it("an unknown id, a date-only entry, extra fields or a malformed id", async () => {
    as("writer");
    expect(await del("00000000-0000-4000-8000-000000000999", "Alpha Traders", "x")).toEqual({ ok: false, error: "That comment no longer exists, so nothing was deleted." });
    expect((await tracker.deleteFollowUpComment({ id: C.a4, partyName: "Alpha Traders", expectedNote: "Alpha note 4", createdById: ids.other })).ok).toBe(false);
    expect((await tracker.deleteFollowUpComment({ id: "not-a-uuid", partyName: "Alpha Traders", expectedNote: "" })).ok).toBe(false);
    await unchanged();
  });

  it("a failed audit write: rolled back, still visible, safe message without details", async () => {
    as("writer");
    await pg.exec(`insert into test_faults values ('audit')`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await del(C.a4!, "Alpha Traders", "Alpha note 4")).toEqual({ ok: false, error: "The comment could not be deleted, so nothing was changed. Please try again." });
    expect(await visibleNotes("Alpha Traders")).toContain("Alpha note 4");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/simulated audit failure|Alpha note 4/);
    await unchanged();
  });
});

describe("history is preserved", () => {
  it("edits before a deletion stay in the audit trail, and the deletion records the latest text", async () => {
    as("writer");
    expect(await tracker.editFollowUpComment({ id: C.a3, expectedNote: "Alpha note 3", note: "Alpha note 3 (edited)" })).toEqual({ ok: true });
    expect(await del(C.a3!, "Alpha Traders", "Alpha note 3 (edited)")).toEqual({ ok: true });
    const trail = (await pg.query<{ event_type: string; from_value: { note: string }; to_value: { note?: string } }>(
      `select event_type, from_value, to_value from employee_events where to_value->>'followupId' = $1 order by created_at, id`, [C.a3],
    )).rows;
    expect(trail.map((t) => [t.event_type, t.from_value.note])).toEqual([
      ["collection_comment_edited", "Alpha note 3"],
      ["collection_comment_deleted", "Alpha note 3 (edited)"],
    ]);
    // The row itself still holds the (edited) text — nothing was erased.
    expect((await pg.query<{ note: string }>(`select note from collection_followups where id = $1`, [C.a3])).rows[0]!.note).toBe("Alpha note 3 (edited)");
  });
});
