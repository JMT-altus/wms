import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// REAL-POSTGRES tests (in-memory PGlite — nothing here can reach a shared or
// production database) of the employee-wise checklist end to end: the real
// server actions, the real scope resolver over real field_permission_grants
// rows, the real upsert into dcc_entries, and the grid arithmetic over what was
// actually stored. The session is MOCKED; the super-admin allowlist is mocked
// to a made-up address so no real account appears here. Nobody is named: the
// people below are test fixtures.
type Me = { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string; departmentId: string | null; designationId: string | null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => {
    if (!h.me?.isActive) throw new Error("redirect:/login");
    return h.me;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: (e: string | null | undefined) => e === "super@example.test" }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { PGlite } from "@electric-sql/pglite";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let actions: typeof import("@/app/(app)/dcc/actions");
let access: typeof import("@/lib/dcc/access");
let queries: typeof import("@/lib/queries/dcc");
let grid: typeof import("@/lib/dcc/grid-model");
let model: typeof import("@/lib/dcc/board-model");
let schemaReady: typeof import("@/lib/dcc/schema-ready");

const ids = { super: "", admin: "", manager: "", report: "", plain: "", dept: "", desig: "" };
const people: Record<string, Me> = {};
const as = (k: keyof typeof people) => {
  h.me = people[k]!;
};
const q = async <T,>(sql: string, p: unknown[] = []) => (await pg.query<T>(sql, p)).rows;
const grant = (key: string, employeeId: string) =>
  pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, employeeId]);
const employee = (k: keyof typeof ids) => ({ ...people[k]! } as unknown as schema.Employee);

// Monday 2 Nov 2026, ISO week 45.
const MON = "2026-11-02";

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    departments: schema.departments,
    designations: schema.designations,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    dccClients: schema.dccClients,
    dccSubjects: schema.dccSubjects,
    dccKpiItems: schema.dccKpiItems,
    dccItemSubjects: schema.dccItemSubjects,
    dccEntries: schema.dccEntries,
    dccReviews: schema.dccReviews,
  });
  pg = made.pg;
  h.db = made.db;
  // The one index the upsert in lib/dcc/write.ts conflicts on (migration 0099).
  await pg.exec(`create unique index if not exists dcc_entries_subject_uq on dcc_entries (item_id, entry_date, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))`);

  ids.dept = (await q<{ id: string }>(`insert into departments (name) values ('Sales') returning id`))[0]!.id;
  ids.desig = (await q<{ id: string }>(`insert into designations (name) values ('Sales Executive') returning id`))[0]!.id;
  const emp = async (k: keyof typeof ids, name: string, email: string, isAdmin: boolean, managerId: string | null, withOrg = false) => {
    const id = (
      await q<{ id: string }>(`insert into employees (name, email, role, is_admin, manager_id, department_id, designation_id) values ($1, $2, 'both', $3, $4, $5, $6) returning id`, [
        name,
        email,
        isAdmin,
        managerId,
        withOrg ? ids.dept : null,
        withOrg ? ids.desig : null,
      ])
    )[0]!.id;
    ids[k] = id;
    people[k] = { id, email, isActive: true, isAdmin, name, departmentId: withOrg ? ids.dept : null, designationId: withOrg ? ids.desig : null };
  };
  await emp("super", "Super", "super@example.test", true, null);
  await emp("admin", "Admin", "admin@example.test", true, null);
  await emp("manager", "Manager", "manager@example.test", false, null);
  await emp("report", "Report", "report@example.test", false, ids.manager, true);
  await emp("plain", "Plain", "plain@example.test", false, null, true);

  actions = await import("@/app/(app)/dcc/actions");
  access = await import("@/lib/dcc/access");
  queries = await import("@/lib/queries/dcc");
  grid = await import("@/lib/dcc/grid-model");
  model = await import("@/lib/dcc/board-model");
  schemaReady = await import("@/lib/dcc/schema-ready");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec("delete from dcc_entries; delete from dcc_kpi_items; delete from field_permission_grants");
});

const kpi = (owner: string, over: Partial<Parameters<typeof actions.createDccItem>[0]> = {}) =>
  actions.createDccItem({ ownerEmployeeId: owner, title: "Total Value of SO Recd", frequency: "Daily", inputType: "number", ...over });
const rows = (itemId: string) => q<{ entry_date: string; status: string | null; value_number: string | null; note: string | null }>(`select entry_date::text, status, value_number, note from dcc_entries where item_id = $1 order by entry_date`, [itemId]);

describe("migration 0124 (prepared, not applied)", () => {
  it("adds input_type and target_period to a 0099-shaped table, is idempotent, and rejects values outside the vocabulary", async () => {
    const fresh = new PGlite();
    await fresh.exec(`create table dcc_kpi_items (id uuid primary key default gen_random_uuid(), title text not null, target_number numeric(14,2))`);
    await fresh.exec(`insert into dcc_kpi_items (title) values ('before 0124')`);
    const sql = readFileSync(path.join(process.cwd(), "db/migrations/0124_dcc_input_type.sql"), "utf8");
    await fresh.exec(sql);
    await fresh.exec(sql); // second run: nothing to do, nothing fails
    const cols = (await fresh.query<{ column_name: string; column_default: string }>(`select column_name, column_default from information_schema.columns where table_name = 'dcc_kpi_items' and column_name in ('input_type','target_period') order by 1`)).rows;
    expect(cols.map((c) => [c.column_name, c.column_default])).toEqual([
      ["input_type", "'yesno'::text"],
      ["target_period", "'day'::text"],
    ]);
    // Existing rows keep working as Yes / No lines with a per-day target.
    expect((await fresh.query<{ input_type: string; target_period: string }>(`select input_type, target_period from dcc_kpi_items`)).rows[0]).toEqual({ input_type: "yesno", target_period: "day" });
    await expect(fresh.exec(`insert into dcc_kpi_items (title, input_type) values ('x', 'emoji')`)).rejects.toThrow(/dcc_kpi_items_input_type_check/);
    await expect(fresh.exec(`insert into dcc_kpi_items (title, target_period) values ('x', 'year')`)).rejects.toThrow(/dcc_kpi_items_target_period_check/);
    await fresh.close();
  });
});

describe("KPI configuration", () => {
  it("an admin sets the answer type, frequency and target period; omitted fields default to Yes / No per day", async () => {
    as("admin");
    const a = await kpi(ids.plain, { targetNumber: 50000, targetPeriod: "week" });
    expect(a.ok).toBe(true);
    const b = await actions.createDccItem({ ownerEmployeeId: ids.plain, title: "Weekly Calls Sheet Done?", frequency: "Weekly" });
    expect(b.ok).toBe(true);
    const stored = await q<{ title: string; input_type: string; target_period: string; schedule_kind: string; target_number: string | null }>(`select title, input_type, target_period, schedule_kind, target_number from dcc_kpi_items order by sort_order`);
    expect(stored).toEqual([
      { title: "Total Value of SO Recd", input_type: "number", target_period: "week", schedule_kind: "scheduled", target_number: "50000.00" },
      { title: "Weekly Calls Sheet Done?", input_type: "yesno", target_period: "day", schedule_kind: "weekly", target_number: null },
    ]);
    // Update changes the type and keeps everything else.
    if (!a.ok) throw new Error("unreachable");
    const u = await actions.updateDccItem({ id: a.id, title: "Total Value of SO Recd", frequency: "Daily", inputType: "text", targetPeriod: "day" });
    expect(u.ok).toBe(true);
    expect((await q<{ input_type: string }>(`select input_type from dcc_kpi_items where id = $1`, [a.id]))[0]!.input_type).toBe("text");
    expect((await actions.createDccItem({ ownerEmployeeId: ids.plain, title: "bad", inputType: "emoji" as never })).ok).toBe(false);
  });

  it("an ordinary employee cannot configure KPIs — not even their own — until granted dcc.kpi.manage", async () => {
    as("plain");
    expect(await kpi(ids.plain)).toEqual({ ok: false, error: "You can't add KPIs for that person" });
    as("manager");
    expect((await kpi(ids.report)).ok).toBe(false); // sees the report, may not configure them
    await grant("dcc.kpi.manage", ids.manager);
    expect((await kpi(ids.report)).ok).toBe(true); // granted, and the report is in scope
    expect((await kpi(ids.plain)).ok).toBe(false); // granted, but Plain is not in the manager's scope
    expect(await q(`select 1 from dcc_kpi_items where owner_employee_id = $1`, [ids.plain])).toHaveLength(0);
  });
});

describe("filling the grid", () => {
  it("a number cell stores the figure (marked Done); re-saving updates the same row; blank deletes it", async () => {
    as("admin");
    const made = await kpi(ids.plain);
    if (!made.ok) throw new Error(made.error);
    as("plain");
    expect(await actions.setDccEntry({ itemId: made.id, date: MON, status: "Done", value: 153671, silent: true })).toEqual({ ok: true });
    expect(await actions.setDccEntry({ itemId: made.id, date: MON, status: "Done", value: 160000, silent: true })).toEqual({ ok: true });
    expect(await rows(made.id)).toEqual([{ entry_date: MON, status: "Done", value_number: "160000.00", note: null }]);
    expect(await actions.setDccEntry({ itemId: made.id, date: MON, status: null, value: null, note: null, silent: true })).toEqual({ ok: true });
    expect(await rows(made.id)).toEqual([]);
  });

  it("Yes / No stores the answer as the status and text stays verbatim; neither is turned into a number", async () => {
    as("admin");
    const yn = await actions.createDccItem({ ownerEmployeeId: ids.plain, title: "Daily Plan Done?", frequency: "Daily", inputType: "yesno" });
    const tx = await actions.createDccItem({ ownerEmployeeId: ids.plain, title: "To whom & what brand?", frequency: "Daily", inputType: "text" });
    if (!yn.ok || !tx.ok) throw new Error("setup");
    as("plain");
    const y = grid.parseCell("yesno", "N");
    const t = grid.parseCell("text", "ROTO / Fenesta");
    if (!y.ok || !t.ok || !y.value || !t.value) throw new Error("parse");
    await actions.setDccEntry({ itemId: yn.id, date: MON, status: y.value.status as "Not done", value: null, note: null, silent: true });
    await actions.setDccEntry({ itemId: tx.id, date: MON, status: t.value.status as "Done", value: null, note: t.value.note, silent: true });
    expect(await rows(yn.id)).toEqual([{ entry_date: MON, status: "Not done", value_number: null, note: null }]);
    expect(await rows(tx.id)).toEqual([{ entry_date: MON, status: "Done", value_number: null, note: "ROTO / Fenesta" }]);
  });

  it("only the owner (or a super-admin) can fill a cell; a manager and an admin cannot", async () => {
    as("admin");
    const made = await kpi(ids.report);
    if (!made.ok) throw new Error(made.error);
    const fill = (v: number) => actions.setDccEntry({ itemId: made.id, date: MON, status: "Done", value: v, silent: true });
    as("manager");
    expect(await fill(1)).toEqual({ ok: false, error: "You can only fill your own DCC" });
    as("admin");
    expect(await fill(2)).toEqual({ ok: false, error: "You can only fill your own DCC" });
    as("report");
    expect(await fill(3)).toEqual({ ok: true });
    as("super");
    expect(await fill(4)).toEqual({ ok: true });
    expect((await rows(made.id)).map((r) => r.value_number)).toEqual(["4.00"]);
  });

  it("Weekly Actual over what was really stored: the sum of the week's figures, and the deficit against a per-day target", async () => {
    as("admin");
    const made = await kpi(ids.plain, { targetNumber: 100000, targetPeriod: "day" });
    if (!made.ok) throw new Error(made.error);
    as("plain");
    const figures: Record<string, number> = { "2026-11-02": 153671, "2026-11-03": 218465, "2026-11-04": 51000, "2026-11-05": 198240, "2026-11-06": 97718 };
    for (const [date, value] of Object.entries(figures)) await actions.setDccEntry({ itemId: made.id, date, status: "Done", value, silent: true });

    const items = (await queries.listOwnerItems(ids.plain)).map(model.toBoardItem);
    const entries = await queries.listOwnerEntries(ids.plain, "2026-11-01");
    const slots = model.indexEntries(entries.map((e) => ({ itemId: e.itemId, entryDate: e.entryDate, status: e.status, valueNumber: e.valueNumber, note: e.note, subjectId: e.subjectId })));
    const week = grid.gridWeeks("2026-11-05", 1)[0]!;
    expect(grid.weekTotals(items[0]!, slots, week)).toEqual({ due: 6, filled: 5, actual: 719094, target: 600000, deficit: -119094 });
  });
});

describe("before migration 0124 is installed (the production database today)", () => {
  // Runs last: it drops the two columns, exercises every read and write the
  // page makes, then installs 0124 for real on the table and checks the app
  // picks it up again. Order within a file is sequential in Vitest.
  it("reads, creates, updates and fills still work, with every KPI a Yes / No line; installing 0124 brings the types back", async () => {
    await pg.exec(`alter table dcc_kpi_items drop column input_type, drop column target_period`);
    schemaReady._resetDccSchemaMemo();
    expect(await schemaReady.dccInputTypeReady()).toBe(false);

    as("admin");
    const made = await kpi(ids.plain, { inputType: "number", targetPeriod: "week", targetNumber: 5 });
    expect(made.ok).toBe(true);
    if (!made.ok) throw new Error("unreachable");
    expect((await actions.updateDccItem({ id: made.id, title: "Renamed", frequency: "Daily", inputType: "text", targetNumber: 5 })).ok).toBe(true);
    const items = await queries.listOwnerItems(ids.plain);
    expect(items.map((i) => [i.title, i.inputType, i.targetPeriod, i.targetNumber])).toEqual([["Renamed", "yesno", "day", "5.00"]]);
    expect((await queries.listItemsForOwners([ids.plain]))[0]!.inputType).toBe("yesno");
    as("plain");
    expect(await actions.setDccEntry({ itemId: made.id, date: MON, status: "Done", silent: true })).toEqual({ ok: true });
    expect((await rows(made.id)).map((r) => r.status)).toEqual(["Done"]);

    // Now install 0124 on this (drizzle-built) table, as production will.
    await pg.exec(readFileSync(path.join(process.cwd(), "db/migrations/0124_dcc_input_type.sql"), "utf8"));
    schemaReady._resetDccSchemaMemo();
    expect(await schemaReady.dccInputTypeReady()).toBe(true);
    as("admin");
    expect((await actions.updateDccItem({ id: made.id, title: "Renamed", frequency: "Daily", inputType: "number", targetPeriod: "week", targetNumber: 5 })).ok).toBe(true);
    expect((await queries.listOwnerItems(ids.plain)).map((i) => [i.inputType, i.targetPeriod])).toEqual([["number", "week"]]);
  });
});

describe("who sees whom", () => {
  it("self only; the reporting line for a manager; everyone for admins, super-admins and holders of dcc.team.view", async () => {
    const visible = async (k: keyof typeof ids) => [...(await access.getDccScope(employee(k))).visibleIds].sort();
    const all = [ids.super, ids.admin, ids.manager, ids.report, ids.plain].sort();
    expect(await visible("plain")).toEqual([ids.plain]);
    expect(await visible("manager")).toEqual([ids.manager, ids.report].sort());
    expect(await visible("super")).toEqual(all);
    expect(await visible("admin")).toEqual(all); // admins hold dcc.team.view through the admin bypass
    await grant("dcc.team.view", ids.plain);
    expect(await visible("plain")).toEqual(all);
    const s = await access.getDccScope(employee("plain"));
    expect(s.isManager).toBe(true);
    expect(s.canManageKpis).toBe(false); // seeing everyone is not configuring anyone
    expect(access.canFill(s, ids.report)).toBe(false); // nor filling for them
  });

  it("the roster carries designation and department for the tabs, from the masters", async () => {
    const roster = await queries.listDccPeople([ids.plain, ids.manager]);
    expect(roster.map((p) => [p.name, p.designation, p.department])).toEqual([
      ["Manager", null, null],
      ["Plain", "Sales Executive", "Sales"],
    ]);
  });
});
