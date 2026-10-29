import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; collection_followups from migration 0110 itself) for:
//   - the escalation reviewer's comments being marked for highlighting — resolved from the permission matrix
//     (collection.escalation.review), never from a name, email or id in code;
//   - editing a comment: author-only, collection.followup.write, empty / stale / duplicate / failed saves,
//     and the audit trail (editor, time, original text) in employee_events.
// Nothing here can reach a shared or production database; only the session is mocked (made-up test addresses).
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
  reviewer: { name: "Reviewer Person", email: "reviewer@example.test", admin: true },
  writer: { name: "Writer One", email: "writer@example.test", admin: true },
  other: { name: "Writer Two", email: "other@example.test", admin: true },
  denied: { name: "Denied Admin", email: "denied@example.test", admin: true },
};
type Who = keyof typeof people;
const ids = {} as Record<Who, string>;
const as = (k: Who) => {
  h.me = { id: ids[k], isAdmin: people[k].admin, isActive: true, email: people[k].email, name: people[k].name };
  h.claims = { email: people[k].email, email_verified: true };
};
const C: Record<string, string> = {};
const noteOf = async (id: string) => (await pg.query<{ note: string | null }>(`select note from collection_followups where id = $1`, [id])).rows[0]!.note;
const editEvents = async () =>
  (await pg.query<{ employee_id: string; actor_id: string; from_value: Record<string, unknown>; to_value: Record<string, unknown>; created_at: string }>(
    `select employee_id, actor_id, from_value, to_value, created_at::text from employee_events where event_type = 'collection_comment_edited' order by created_at, id`,
  )).rows;
async function addComment(key: string, who: Who, note: string, at: string) {
  C[key] = (await pg.query<{ id: string }>(`insert into collection_followups (party_name, note, created_by_id, created_at) values ('Alpha Traders', $1, $2, $3) returning id`, [note, ids[who], at])).rows[0]!.id;
}

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
  // The reviewer is whoever holds collection.escalation.review — granted here exactly as the permission matrix stores it.
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.escalation.review', 'employee', $1, true)`, [ids.reviewer]);
  for (const k of ["reviewer", "writer", "other"] as Who[]) {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.followup.write', 'employee', $1, true)`, [ids[k]]);
  }
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.followup.write', 'employee', $1, false)`, [ids.denied]);
  await addComment("reviewer", "reviewer", "Reviewer: please call them today.", "2026-10-20T05:00:00Z");
  await addComment("writer", "writer", "Spoke to accounts; payment next week.", "2026-10-21T05:00:00Z");
  await addComment("other", "other", "Left a voicemail.", "2026-10-22T05:00:00Z");
  await pg.exec(`insert into collection_followups (party_name, next_followup_date, created_by_id) values ('Alpha Traders', '2026-11-30', '${ids.writer}')`);
  C.dateOnly = (await pg.query<{ id: string }>(`select id from collection_followups where note is null`)).rows[0]!.id;
  // A switchable failure of the audit write, to prove the edit and its audit row commit together or not at all.
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

describe("the escalation reviewer's comments are marked for highlighting — for every viewer, from the permission matrix", () => {
  it("only the comment by the holder of collection.escalation.review is marked; the others are not", async () => {
    for (const viewer of ["writer", "other", "reviewer"] as Who[]) {
      as(viewer);
      const { entries } = await followups.listFollowUps();
      const by = Object.fromEntries(entries.filter((e) => e.note).map((e) => [e.id, e.authorIsReviewer]));
      expect(by, `viewer ${viewer}`).toEqual({ [C.reviewer!]: true, [C.writer!]: false, [C.other!]: false });
    }
  });

  it("it follows the grant, not the person's name: revoking the grant removes the highlight; granting it to someone else adds theirs", async () => {
    await pg.query(`update field_permission_grants set allowed = false where field_key = 'collection.escalation.review' and subject_id = $1`, [ids.reviewer]);
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.escalation.review', 'employee', $1, true)`, [ids.other]);
    try {
      const { entries } = await followups.listFollowUps();
      const by = Object.fromEntries(entries.filter((e) => e.note).map((e) => [e.id, e.authorIsReviewer]));
      expect(by).toEqual({ [C.reviewer!]: false, [C.writer!]: false, [C.other!]: true });
    } finally {
      await pg.query(`update field_permission_grants set allowed = true where field_key = 'collection.escalation.review' and subject_id = $1`, [ids.reviewer]);
      await pg.query(`delete from field_permission_grants where field_key = 'collection.escalation.review' and subject_id = $1`, [ids.other]);
    }
  });

  it("an admin is NOT a reviewer by being an admin (the capability is sensitive: no admin bypass)", async () => {
    const { entries } = await followups.listFollowUps();
    expect(entries.find((e) => e.id === C.writer)!.authorIsReviewer).toBe(false); // writer is an admin without the grant
  });
});

describe("editing a comment", () => {
  const edit = (id: string, expectedNote: string, note: string) => tracker.editFollowUpComment({ id, expectedNote, note });

  it("the author can edit their own comment; the audit trail records the editor, the time and the ORIGINAL text", async () => {
    as("writer");
    const original = "Spoke to accounts; payment next week.";
    expect(await edit(C.writer!, original, "  Spoke to accounts; payment on Monday.  ")).toEqual({ ok: true });
    expect(await noteOf(C.writer!)).toBe("Spoke to accounts; payment on Monday."); // trimmed
    const ev = await editEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      employee_id: ids.writer, actor_id: ids.writer,
      from_value: { followupId: C.writer, partyName: "Alpha Traders", note: original },
      to_value: { followupId: C.writer, note: "Spoke to accounts; payment on Monday." },
    });
    // The comment keeps its original author and time; the list shows who edited it and when.
    const row = (await followups.listFollowUps()).entries.find((e) => e.id === C.writer)!;
    expect(row).toMatchObject({ createdById: ids.writer, createdByName: "Writer One", editedByName: "Writer One" });
    expect(row.createdAt.toISOString()).toBe("2026-10-21T05:00:00.000Z");
    expect(row.editedAt).toBeInstanceOf(Date);
  });

  it("a second edit keeps the full history: each audit row has the text before it", async () => {
    as("writer");
    expect(await edit(C.writer!, "Spoke to accounts; payment on Monday.", "Payment received.")).toEqual({ ok: true });
    const ev = await editEvents();
    expect(ev.map((e) => [e.from_value.note, e.to_value.note])).toEqual([
      ["Spoke to accounts; payment next week.", "Spoke to accounts; payment on Monday."],
      ["Spoke to accounts; payment on Monday.", "Payment received."],
    ]);
  });

  it("sending the same edit twice (double click, retry) saves once", async () => {
    as("writer");
    const before = (await editEvents()).length;
    expect(await edit(C.writer!, "Payment received.", "Payment received in full.")).toEqual({ ok: true });
    expect(await edit(C.writer!, "Payment received.", "Payment received in full.")).toEqual({ ok: true });
    expect(await noteOf(C.writer!)).toBe("Payment received in full.");
    expect((await editEvents()).length).toBe(before + 1);
  });

  it("someone else's comment can't be edited — even by a holder of collection.followup.write, or by the reviewer", async () => {
    const before = await editEvents();
    for (const who of ["other", "reviewer"] as Who[]) {
      as(who);
      expect(await edit(C.writer!, "Payment received in full.", "Overwritten")).toEqual({ ok: false, error: "You can only edit your own comments." });
    }
    expect(await noteOf(C.writer!)).toBe("Payment received in full.");
    expect(await editEvents()).toEqual(before);
  });

  it("without collection.followup.write (an explicit Deny outranks the admin bypass) the action is Forbidden before anything is read", async () => {
    as("denied");
    await expect(edit(C.writer!, "Payment received in full.", "Nope")).rejects.toThrow(/Forbidden/);
    h.me = null; // signed out
    await expect(edit(C.writer!, "Payment received in full.", "Nope")).rejects.toThrow(/Forbidden/);
    expect(await noteOf(C.writer!)).toBe("Payment received in full.");
  });

  it("an empty or whitespace-only comment is refused", async () => {
    as("other");
    for (const note of ["", "   ", "\n\t"]) {
      expect(await edit(C.other!, "Left a voicemail.", note)).toEqual({ ok: false, error: "A comment can't be empty." });
    }
    expect(await noteOf(C.other!)).toBe("Left a voicemail.");
  });

  it("a concurrent change is not overwritten: an edit started from stale text is refused", async () => {
    as("other");
    await pg.query(`update collection_followups set note = 'Changed in another tab' where id = $1`, [C.other]);
    const before = (await editEvents()).length;
    const r = await edit(C.other!, "Left a voicemail.", "My edit");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/changed by someone else after you opened it/);
    expect(await noteOf(C.other!)).toBe("Changed in another tab");
    expect((await editEvents()).length).toBe(before);
    await pg.query(`update collection_followups set note = 'Left a voicemail.' where id = $1`, [C.other]);
  });

  it("a failed audit write rolls the edit back too, with a safe message", async () => {
    as("other");
    await pg.exec(`insert into test_faults values ('audit')`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = (await editEvents()).length;
    expect(await edit(C.other!, "Left a voicemail.", "Called back, no answer")).toEqual({
      ok: false, error: "The comment could not be saved, so nothing was changed. Please try again.",
    });
    expect(await noteOf(C.other!)).toBe("Left a voicemail.");
    expect((await editEvents()).length).toBe(before);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/simulated audit failure|Called back/);
  });

  it("refuses unknown ids, date-only entries, extra fields and over-long text", async () => {
    as("writer");
    expect(await edit("00000000-0000-4000-8000-000000000999", "x", "y")).toEqual({ ok: false, error: "That comment no longer exists, so nothing was changed." });
    expect(await edit(C.dateOnly!, "", "Add a note")).toEqual({ ok: false, error: "This entry has no comment to edit." });
    expect((await tracker.editFollowUpComment({ id: C.writer, expectedNote: "x", note: "y", createdById: ids.other })).ok).toBe(false);
    expect((await edit(C.writer!, "Payment received in full.", "x".repeat(2001))).ok).toBe(false);
    expect((await tracker.editFollowUpComment({ id: "not-a-uuid", expectedNote: "", note: "y" })).ok).toBe(false);
    expect(await noteOf(C.writer!)).toBe("Payment received in full.");
  });
});
