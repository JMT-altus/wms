import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite — nothing here can reach a shared or
// production database) of the bulk KPI setup end to end: the real preview and
// apply actions, the real scope resolver over real field_permission_grants
// rows, one transaction, idempotent re-runs. The session is MOCKED; the
// super-admin allowlist is mocked to a made-up address. The people and tab
// labels below are fixtures, not anyone real.
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
import { MASK_MON_SAT } from "@/lib/dcc/util";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let actions: typeof import("@/app/(app)/dcc/actions");
let access: typeof import("@/lib/dcc/access");
let queries: typeof import("@/lib/queries/dcc");

const ids = { admin: "", manager: "", report: "", asha: "", bala: "" };
const people: Record<string, Me> = {};
const as = (k: keyof typeof people) => {
  h.me = people[k]!;
};
const q = async <T,>(sql: string, p: unknown[] = []) => (await pg.query<T>(sql, p)).rows;
const employee = (k: keyof typeof ids) => ({ ...people[k]! } as unknown as schema.Employee);
const TUE = 1 << 1;
const SAT = 1 << 5;

const TEXT = [
  "# AR – Asha",
  "1 | Tally - Total Value of SO Recd | Daily | Number",
  "3 | Tally - Total Collection Recd | Previous day | Number",
  "9 | Sales - Enquiry Funnel - Updated? (Y/N) till date? | Sat / Tues | Yes/No",
  "10 | Sales - Visit - Appointment taken/Planned? (Y/N/NA) | Daily | Y/N/NA",
  "4.1 | To whom & what brand? | | Text",
  "",
  "# BI – Bala",
  "1 | Did you do the Morning meeting? (Y/N) | Daily | Yes/No",
  "2 | GST Compliance Coordination with CA? | Weekly | Text",
  "",
  "# X_1 (no employee on the tab)",
  "1 | Something for someone | Daily | Number",
].join("\n");

const itemsOf = async (owner: string) =>
  (await queries.listOwnerItems(owner)).map((i) => ({ code: i.code, title: i.title, frequency: i.frequency, kind: i.scheduleKind, weekdays: i.weekdays, review: i.needsReview, type: i.inputType, sort: i.sortOrder }));

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
  const emp = async (k: keyof typeof ids, name: string, email: string, isAdmin: boolean, managerId: string | null) => {
    const id = (await q<{ id: string }>(`insert into employees (name, email, role, is_admin, manager_id) values ($1, $2, 'both', $3, $4) returning id`, [name, email, isAdmin, managerId]))[0]!.id;
    ids[k] = id;
    people[k] = { id, email, isActive: true, isAdmin, name, departmentId: null, designationId: null };
  };
  await emp("admin", "Admin", "admin@example.test", true, null);
  await emp("manager", "Manager", "manager@example.test", false, null);
  await emp("report", "Report", "report@example.test", false, ids.manager);
  await emp("asha", "Asha Rao", "asha@example.test", false, null);
  await emp("bala", "Bala Iyer", "bala@example.test", false, null);
  actions = await import("@/app/(app)/dcc/actions");
  access = await import("@/lib/dcc/access");
  queries = await import("@/lib/queries/dcc");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec("delete from dcc_entries; delete from dcc_kpi_items; delete from field_permission_grants");
});

describe("preview", () => {
  it("maps each tab to a suggested person from the roster, marks the unnamed tab as needing mapping, writes nothing", async () => {
    as("admin");
    const r = await actions.previewDccBulkImport({ text: TEXT });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const p = r.preview;
    expect(p.groups.map((g) => [g.label.split(" ")[0], g.employeeName, g.suggested, g.canManage])).toEqual([
      ["AR", "Asha Rao", true, true],
      ["BI", "Bala Iyer", true, true],
      ["X_1", null, false, false],
    ]);
    expect(p.groups[0]!.lines.map((l) => l.status)).toEqual(["create", "create", "create", "create", "create"]);
    expect(p.groups[0]!.lines.map((l) => l.reads)).toEqual(["Due Daily", "Due Daily", "Due Tue · Sat", "Due Daily", "Ad-hoc"]);
    expect(p.groups[2]!.lines[0]!.status).toBe("unassigned");
    expect([p.willCreate, p.willUpdate, p.willSkip, p.unresolved, p.applicable, p.blocking]).toEqual([7, 0, 0, 1, 2, []]);
    expect(await q(`select 1 from dcc_kpi_items`)).toHaveLength(0);
  });

  it("the admin's mapping wins over the suggestion; a person outside the viewer's scope blocks", async () => {
    as("admin");
    const r = await actions.previewDccBulkImport({ text: TEXT, mapping: { "AR – Asha": ids.bala, "X_1 (no employee on the tab)": ids.asha } });
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.groups.map((g) => g.employeeName)).toEqual(["Bala Iyer", "Bala Iyer", "Asha Rao"]);
    expect(r.preview.groups[0]!.suggested).toBe(false);
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('dcc.kpi.manage', 'employee', $1, true)`, [ids.manager]);
    as("manager");
    const m = await actions.previewDccBulkImport({ text: TEXT, mapping: { "AR – Asha": ids.asha, "BI – Bala": ids.report } });
    if (!m.ok) throw new Error(m.error);
    expect(m.preview.groups[0]!.errors[0]).toMatch(/not in your scope/);
    expect(m.preview.groups[1]!.canManage).toBe(true); // the report is in the manager's line
    expect(m.preview.blocking).toHaveLength(1);
  });
});

describe("apply", () => {
  it("creates every mapped KPI in sheet order with code, frequency words, weekday mask, answer type; skips the unmapped tab", async () => {
    as("admin");
    const r = await actions.applyDccBulkImport({ text: TEXT });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect([r.summary.created, r.summary.updated, r.summary.skipped, r.summary.unresolved]).toEqual([7, 0, 0, 1]);
    expect(r.summary.groups.map((g) => [g.employeeName, g.created])).toEqual([
      ["Asha Rao", 5],
      ["Bala Iyer", 2],
      [null, 0],
    ]);
    expect(await itemsOf(ids.asha)).toEqual([
      { code: "1", title: "Tally - Total Value of SO Recd", frequency: "Daily", kind: "scheduled", weekdays: MASK_MON_SAT, review: false, type: "number", sort: 1 },
      { code: "3", title: "Tally - Total Collection Recd", frequency: "Previous day", kind: "scheduled", weekdays: MASK_MON_SAT, review: false, type: "number", sort: 2 },
      { code: "9", title: "Sales - Enquiry Funnel - Updated? (Y/N) till date?", frequency: "Sat / Tues", kind: "scheduled", weekdays: TUE | SAT, review: false, type: "yesno", sort: 3 },
      { code: "10", title: "Sales - Visit - Appointment taken/Planned? (Y/N/NA)", frequency: "Daily", kind: "scheduled", weekdays: MASK_MON_SAT, review: false, type: "yesno", sort: 4 },
      { code: "4.1", title: "To whom & what brand?", frequency: null, kind: "adhoc", weekdays: null, review: true, type: "text", sort: 5 },
    ]);
    expect((await itemsOf(ids.bala)).map((i) => [i.title, i.kind, i.type])).toEqual([
      ["Did you do the Morning meeting? (Y/N)", "scheduled", "yesno"],
      ["GST Compliance Coordination with CA?", "weekly", "text"],
    ]);
    expect(await q(`select count(*)::int as n from dcc_kpi_items`)).toEqual([{ n: 7 }]);
    expect(await q(`select 1 from dcc_kpi_items where title = 'Something for someone'`)).toHaveLength(0);
    // No target, unit, section, participant flag or entry is invented.
    expect(await q(`select count(*)::int as n from dcc_kpi_items where target_number is not null or unit is not null or section is not null or is_participant_list`)).toEqual([{ n: 0 }]);
    expect(await q(`select 1 from dcc_entries`)).toHaveLength(0);
  });

  it("is idempotent: the same text again creates nothing and changes nothing; a differing line is kept unless asked to update", async () => {
    as("admin");
    await actions.applyDccBulkImport({ text: TEXT });
    const before = await q<{ id: string; updated_at: string }>(`select id, updated_at::text from dcc_kpi_items order by id`);
    const again = await actions.applyDccBulkImport({ text: TEXT });
    if (!again.ok) throw new Error(again.error);
    expect([again.summary.created, again.summary.updated, again.summary.skipped]).toEqual([0, 0, 7]);
    expect(await q(`select id, updated_at::text from dcc_kpi_items order by id`)).toEqual(before);

    // The same title with a different type: previewed as "differs", kept as is …
    const changed = TEXT.replace("1 | Tally - Total Value of SO Recd | Daily | Number", "1 | tally - total value of so recd | Daily | Text");
    const p = await actions.previewDccBulkImport({ text: changed });
    if (!p.ok) throw new Error(p.error);
    expect(p.preview.groups[0]!.lines[0]!.status).toBe("differs");
    const kept = await actions.applyDccBulkImport({ text: changed });
    if (!kept.ok) throw new Error(kept.error);
    expect([kept.summary.created, kept.summary.updated, kept.summary.skipped]).toEqual([0, 0, 7]);
    expect((await itemsOf(ids.asha))[0]!.type).toBe("number");
    // … and realigned only when the admin asks; the title and the row id stay.
    const upd = await actions.applyDccBulkImport({ text: changed, updateDiffering: true });
    if (!upd.ok) throw new Error(upd.error);
    expect([upd.summary.created, upd.summary.updated, upd.summary.skipped]).toEqual([0, 1, 6]);
    const after = await itemsOf(ids.asha);
    expect(after[0]!.type).toBe("text");
    expect(after[0]!.title).toBe("Tally - Total Value of SO Recd");
    expect((await q<{ id: string }>(`select id from dcc_kpi_items order by id`)).map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(await q(`select count(*)::int as n from dcc_kpi_items`)).toEqual([{ n: 7 }]);
  });

  it("refuses the whole paste when a mapped line is invalid, and refuses when nothing is mapped — nothing partial is ever written", async () => {
    as("admin");
    const bad = TEXT.replace("| Daily | Number", "| Daily | Emoji");
    const r = await actions.applyDccBulkImport({ text: bad });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toMatch(/Fix before applying/);
    expect(await q(`select 1 from dcc_kpi_items`)).toHaveLength(0);
    const none = await actions.applyDccBulkImport({ text: TEXT, mapping: { "AR – Asha": null, "BI – Bala": null } });
    expect(none).toEqual({ ok: false, error: "Map at least one group to an employee you can configure" });
    expect(await q(`select 1 from dcc_kpi_items`)).toHaveLength(0);
  });

  it("honours the existing permission model: no dcc.kpi.manage → refused; a manager with it configures only their line; employees then see only their own list", async () => {
    as("asha");
    expect(await actions.applyDccBulkImport({ text: TEXT })).toEqual({ ok: false, error: "You can't configure KPIs" });
    as("manager");
    expect(await actions.applyDccBulkImport({ text: TEXT })).toEqual({ ok: false, error: "You can't configure KPIs" });
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('dcc.kpi.manage', 'employee', $1, true)`, [ids.manager]);
    // Mapped to the report (in the line): fine. Asha and Bala are outside the manager's scope, so those tabs must be left unassigned.
    const r = await actions.applyDccBulkImport({ text: TEXT, mapping: { "AR – Asha": null, "BI – Bala": ids.report } });
    if (!r.ok) throw new Error(r.error);
    expect([r.summary.created, r.summary.unresolved]).toEqual([2, 2]);
    expect((await itemsOf(ids.report)).map((i) => i.title)).toEqual(["Did you do the Morning meeting? (Y/N)", "GST Compliance Coordination with CA?"]);
    expect(await itemsOf(ids.asha)).toEqual([]);
    // Visibility is unchanged by the import: each employee's scope is still just themselves.
    const s = await access.getDccScope(employee("report"));
    expect([...s.visibleIds]).toEqual([ids.report]);
    expect(access.canManageItems(s, ids.report)).toBe(false);
  });
});
