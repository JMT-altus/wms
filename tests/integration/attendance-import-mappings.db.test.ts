import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REGRESSION — "Remember these matches" on the Attendance Bulk Upload page, on an
// in-memory PGlite database built from db/schema.ts (nothing here can reach a
// shared or production database).
//
// The bug: production never had migration 0111, so biometric_employee_map did
// not exist. Loading threw out of the server action ("Saved matches could not be
// loaded") and saving failed with a generic "could not be saved". These tests
// prove the actions persist for real on a database that has the table, and say
// clearly what is wrong on one that does not. Names here are placeholders; the
// codes are the eleven from the reported upload.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, admin: true, me: { id: "", isAdmin: true } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  requireAdmin: async () => {
    if (!h.admin) throw new Error("Forbidden");
    return h.me;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let actions: typeof import("@/app/(app)/hr/attendance-import/mapping-actions");

const CODES = ["1", "3", "23", "30", "34", "14", "29", "12", "28", "32", "31"];
const nameInFile = (i: number) => `FileName${String(i + 1).padStart(2, "0")}`;
const EMP: string[] = []; // EMP[i] is matched to CODES[i]
let INACTIVE = "";
let SPARE = "";

const sources = () => CODES.map((code, i) => ({ key: `row-${i}`, code, name: nameInFile(i) }));
const reviewed = () => CODES.map((code, i) => ({ code, name: nameInFile(i), employeeId: EMP[i]! }));
const save = (items: unknown[], acknowledged: unknown = true) => actions.saveConfirmedMappings({ items, acknowledged });

/** Everything that identifies the saved matches, in a stable order. */
const mapFingerprint = async () =>
  (await pg.query<{ c: string; e: string; n: string }>(`select biometric_code c, employee_id e, name_in_file n from biometric_employee_map order by biometric_code`)).rows;
const eventCount = async () => (await pg.query<{ n: number }>(`select count(*)::int n from employee_events`)).rows[0]!.n;

async function addEmployee(name: string, isActive = true) {
  const r = await pg.query<{ id: string }>(
    `insert into employees (name, email, role, is_active) values ($1, $2, 'both', $3) returning id`,
    [name, `${name.toLowerCase()}@example.test`, isActive],
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    employeeEvents: schema.employeeEvents,
    biometricEmployeeMap: schema.biometricEmployeeMap,
  });
  pg = made.pg;
  h.db = made.db;
  actions = await import("@/app/(app)/hr/attendance-import/mapping-actions");
  h.me = { id: await addEmployee("HrAdmin"), isAdmin: true };
  for (let i = 0; i < CODES.length; i++) EMP.push(await addEmployee(`Person${String(i + 1).padStart(2, "0")}`));
  INACTIVE = await addEmployee("Former", false);
  SPARE = await addEmployee("Spare");

  // A switchable fault in the audit write, to prove the whole save rolls back.
  await pg.exec(`
    create table test_faults (kind text primary key);
    create function test_fail_events() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from test_faults where kind = 'events') then raise exception 'simulated audit failure'; end if;
      if exists (select 1 from test_faults where kind = 'unique') then raise exception 'simulated race' using errcode = '23505'; end if;
      return new;
    end $$;
    create trigger test_fail_events before insert on employee_events for each row execute function test_fail_events();
  `);
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  h.admin = true;
  __resetRateLimitForTests();
  await pg.exec(`delete from test_faults`);
});
afterEach(async () => {
  await pg.exec(`delete from test_faults`);
  vi.restoreAllMocks();
});

// The describes run in order: an empty table, the save of all eleven, then
// everything that must leave those eleven untouched.
describe("loading and saving the eleven reviewed matches", () => {
  it("loads cleanly when nothing is saved yet: every code is 'no saved match', nothing pre-selected", async () => {
    const r = await actions.lookupSavedMappings({ sources: sources() });
    if (!r.ok) throw new Error(r.error);
    expect(Object.values(r.suggestions).map((s) => s.status)).toEqual(CODES.map(() => "unresolved"));
  });

  it("saves all 11 reviewed matches, with the confirming admin and one audit event each", async () => {
    const r = await save(reviewed());
    expect(r).toEqual({ ok: true, saved: { created: 11, confirmed: 0, changed: 0, unchanged: 0 } });
    const rows = await pg.query<{ c: string; e: string; by: string }>(`select biometric_code c, employee_id e, confirmed_by_id by from biometric_employee_map`);
    expect(rows.rows).toHaveLength(11);
    for (const [i, code] of CODES.entries()) expect(rows.rows.find((x) => x.c === code)).toMatchObject({ e: EMP[i], by: h.me.id });
    const ev = await pg.query<{ t: string }>(`select event_type t from employee_events`);
    expect(ev.rows.map((x) => x.t)).toEqual(CODES.map(() => "biometric_map_created"));
  });

  it("reopening the screen loads all 11 and pre-selects the right person for each code", async () => {
    const r = await actions.lookupSavedMappings({ sources: sources() });
    if (!r.ok) throw new Error(r.error);
    for (const [i] of CODES.entries()) expect(r.suggestions[`row-${i}`]).toMatchObject({ status: "matched", employeeId: EMP[i] });
  });

  it("saving the same 11 again writes nothing", async () => {
    const before = await eventCount();
    expect(await save(reviewed())).toEqual({ ok: true, saved: { created: 0, confirmed: 0, changed: 0, unchanged: 11 } });
    expect(await eventCount()).toBe(before);
  });
});

describe("refused saves leave the saved matches exactly as they were", () => {
  let saved: Awaited<ReturnType<typeof mapFingerprint>>;
  beforeAll(async () => {
    saved = await mapFingerprint();
  });
  afterEach(async () => {
    expect(await mapFingerprint()).toEqual(saved);
  });

  it("an employee id that is not a real employee", async () => {
    const r = await save([{ code: "77", name: "X", employeeId: "00000000-0000-4000-8000-000000000077" }]);
    expect(!r.ok && r.error).toMatch(/no longer exists/);
  });
  it("an employee id that is not an id at all", async () => {
    expect((await save([{ code: "77", name: "X", employeeId: "not-a-uuid" }])).ok).toBe(false);
  });
  it("an inactive employee", async () => {
    expect(await save([{ code: "77", name: "X", employeeId: INACTIVE }])).toMatchObject({ ok: false, error: expect.stringMatching(/inactive/) });
  });
  it("a blank or placeholder code", async () => {
    expect((await save([{ code: "   ", name: "X", employeeId: SPARE }])).ok).toBe(false);
    expect(await save([{ code: "—", name: "X", employeeId: SPARE }])).toMatchObject({ ok: false, error: expect.stringMatching(/no real employee code/) });
  });
  it("the same code twice, or the same person twice, in one request", async () => {
    expect(await save([{ code: "77", name: "X", employeeId: SPARE }, { code: "77", name: "Y", employeeId: INACTIVE }])).toMatchObject({ ok: false, error: expect.stringMatching(/more than once/) });
    expect(await save([{ code: "77", name: "X", employeeId: SPARE }, { code: "78", name: "Y", employeeId: SPARE }])).toMatchObject({ ok: false, error: expect.stringMatching(/more than one code/) });
  });
  it("moving a saved code to someone else, or giving a saved person a second code, without an explicit replace", async () => {
    const moved = await save([{ code: CODES[0], name: nameInFile(0), employeeId: SPARE }]);
    expect(moved).toMatchObject({ ok: false, conflicts: [{ code: CODES[0], employeeId: SPARE }] });
    const second = await save([{ code: "77", name: "X", employeeId: EMP[1] }]);
    expect(second).toMatchObject({ ok: false, conflicts: [{ code: "77", employeeId: EMP[1] }] });
  });
  it("without the review confirmation", async () => {
    expect((await actions.saveConfirmedMappings({ items: [{ code: "77", name: "X", employeeId: SPARE }] })).ok).toBe(false);
    expect((await save([{ code: "77", name: "X", employeeId: SPARE }], false)).ok).toBe(false);
  });
  it("by someone who is not an admin", async () => {
    h.admin = false;
    await expect(save([{ code: "77", name: "X", employeeId: SPARE }])).rejects.toThrow(/Forbidden/);
    await expect(actions.lookupSavedMappings({ sources: sources() })).rejects.toThrow(/Forbidden/);
  });

  it("a database failure mid-save rolls back the whole batch (new rows AND a replace's delete), with a safe message", async () => {
    await pg.exec(`insert into test_faults values ('events')`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await save([
      { code: "77", name: "NewFileName", employeeId: SPARE },
      { code: CODES[2], name: nameInFile(2), employeeId: EMP[2]! }, // an unchanged item alongside
    ]);
    expect(r).toEqual({ ok: false, error: "The matches could not be saved. Nothing was changed." });
    // Diagnostics keep the database's reason, never the names or ids from the request.
    expect(log).toHaveBeenCalled();
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toMatch(/simulated audit failure/);
    expect(logged).not.toMatch(/NewFileName|FileName03|@example\.test/);
    expect(logged).not.toContain(SPARE);
  });

  it("a replace that fails mid-save keeps the old link (the delete is rolled back too)", async () => {
    await pg.exec(`insert into test_faults values ('events')`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await save([{ code: CODES[0], name: nameInFile(0), employeeId: SPARE, replace: true }]);
    expect(r.ok).toBe(false);
  });

  it("a unique-constraint race reported through Drizzle's wrapped error gets the 'same moment' message", async () => {
    await pg.exec(`insert into test_faults values ('unique')`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await save([{ code: "77", name: "X", employeeId: SPARE }]);
    expect(!r.ok && r.error).toMatch(/same moment/);
  });
});

describe("a database without the table (migration 0111 not applied — the production state)", () => {
  beforeAll(async () => {
    await pg.exec(`alter table biometric_employee_map rename to biometric_employee_map_hidden`);
  });
  afterAll(async () => {
    await pg.exec(`alter table biometric_employee_map_hidden rename to biometric_employee_map`);
  });

  it("loading returns a clear reason instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await actions.lookupSavedMappings({ sources: sources() });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/not installed on this database yet; database update 0111 is needed/) });
  });

  it("saving says why, writes nothing and logs only the Postgres code and reason", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await eventCount();
    const r = await save(reviewed());
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^The matches could not be saved because .*0111 is needed\. Nothing was changed\.$/) });
    expect(await eventCount()).toBe(events);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toMatch(/42P01/);
    expect(logged).not.toMatch(/FileName|@example\.test/);
  });
});
