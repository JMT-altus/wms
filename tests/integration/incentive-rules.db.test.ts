import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite running migration 0131's own SQL) for Admin & Master Setup → Incentive Rules:
// rights, the draft → submit → approve → publish workflow, maker-checker, rejection, effective dates, immutability,
// history, concurrency, and that the existing Incentive Tracker's records are untouched. Invented data only; only the
// session (and which addresses count as super-admins) is mocked. Nothing here reaches a real database.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean; departmentId: null } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ SUPER_ADMIN_EMAILS: ["root@example.test"], isSuperAdmin: (e: string | null | undefined) => (e ?? "").trim().toLowerCase() === "root@example.test" }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { completeConfig } from "../fixtures/incentive-config";
import type { IncentiveConfig } from "@/lib/incentives/rules-config/spec";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let act: typeof import("@/app/(masters)/master-setup/incentive-rules/actions");
let rules: typeof import("@/lib/queries/incentive-rules");
const PEOPLE = ["root", "editor", "editorApprover", "approver", "publisher", "backdater", "viewer", "historian", "plainAdmin", "staff"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const GRANTS: Partial<Record<Who, string[]>> = {
  editor: ["edit", "submit"],
  editorApprover: ["edit", "approve"],
  approver: ["approve"],
  publisher: ["publish"],
  backdater: ["publish", "backdate"],
  viewer: ["view"],
  historian: ["view", "history"],
};
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k.toLowerCase()}@example.test`, name: k, isActive: true, isAdmin: k !== "staff", departmentId: null };
};
const MIGRATION = readFileSync(resolve(__dirname, "../../db/migrations/0131_incentive_rule_config.sql"), "utf8");
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const version = async (id: string) => (await q1<{ status: string; row_version: number; effective_from: string | null; effective_to: string | null; approved_by_id: string | null; created_by_id: string | null }>(`select status, row_version, effective_from::text, effective_to::text, approved_by_id, created_by_id from incentive_config_versions where id = $1`, [id]))[0]!;
const rv = async (id: string) => (await version(id)).row_version;
const historyOf = async (id: string) => q1<{ action: string; actor_name: string; before: { config?: IncentiveConfig } | null; after: { config?: IncentiveConfig; status?: string } | null; note: string | null }>(`select action, actor_name, before, after, note from incentive_config_history where version_id = $1 order by event_no`, [id]);
const monthAdd = (monthStart: string, n: number) => {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 10);
};
let thisMonth = "";

/** The existing Incentive Tracker's tables: row count and a hash of every row, to prove nothing changes them. */
const TRACKER_TABLES = ["customers", "sales_orders", "invoices", "receipts", "incentive_schemes", "rule_versions", "incentive_periods", "incentive_ledger", "payout_runs", "incentive_audit"];
async function trackerFingerprint() {
  const out: Record<string, string> = {};
  for (const t of TRACKER_TABLES) out[t] = (await q1<{ f: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as f from ${t} t`))[0]!.f;
  return out;
}
let trackerBefore: Record<string, string> = {};

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    customers: schema.customers,
    salesOrders: schema.salesOrders,
    invoices: schema.invoices,
    receipts: schema.receipts,
    incentiveSchemes: schema.incentiveSchemes,
    ruleVersions: schema.ruleVersions,
    incentivePeriods: schema.incentivePeriods,
    incentiveLedger: schema.incentiveLedger,
    payoutRuns: schema.payoutRuns,
    incentiveAudit: schema.incentiveAudit,
  });
  pg = made.pg;
  h.db = made.db;
  for (const k of PEOPLE) who[k] = (await q1<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k.toLowerCase()}@example.test`, k !== "staff"]))[0]!.id;
  for (const [k, rights] of Object.entries(GRANTS)) for (const r of rights!) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [`incentive.rules.${r}`, who[k as Who]]);

  // The existing tracker's records, like production's: 8 confirmed orders with invoices, 5 receipts, a published scheme,
  // 7 periods of which one is paid with its payout run, and ledger rows.
  const cust = (await q1<{ id: string }>(`insert into customers (name) values ('Sample Customer') returning id`))[0]!.id;
  const scheme = (await q1<{ id: string }>(`insert into incentive_schemes (name, scope_role) values ('Sales BH', 'sales_bh') returning id`))[0]!.id;
  await pg.query(`insert into rule_versions (scheme_id, version, config, effective_from) values ($1, 1, '{"schemeMonthlyCapPaise":1825000}', '2026-05-01')`, [scheme]);
  for (let i = 1; i <= 8; i++) {
    const order = (await q1<{ id: string }>(`insert into sales_orders (customer_id, owner_id, order_value_paise, category_code, booked_at, confirmed) values ($1, $2, $3, 'A', '2026-06-0${i}', true) returning id`, [cust, who.viewer, i * 1_00_000_00]))[0]!.id;
    const inv = (await q1<{ id: string }>(`insert into invoices (order_id, invoice_value_paise, invoice_date, agreed_terms_days) values ($1, $2, '2026-06-0${i}', 30) returning id`, [order, i * 1_00_000_00]))[0]!.id;
    if (i <= 5) await pg.query(`insert into receipts (invoice_id, amount_paise, received_at) values ($1, $2, '2026-07-0${i}')`, [inv, i * 1_00_000_00]);
  }
  const periods: string[] = [];
  for (let m = 1; m <= 7; m++) periods.push((await q1<{ id: string }>(`insert into incentive_periods (month, status) values ($1, $2) returning id`, [`2026-0${m}`, m === 5 ? "paid" : "open"]))[0]!.id);
  await pg.query(`insert into payout_runs (period_id, total_paise) values ($1, 900000)`, [periods[4]]);
  await pg.query(`insert into incentive_ledger (employee_id, period_id, rule_line_code, category, entry_type, amount_paise, source_ref) values ($1, $2, 'A.1', 'A', 'accrual', 200000, 'slab:A.1')`, [who.viewer, periods[4]]);
  trackerBefore = await trackerFingerprint();

  await pg.exec(MIGRATION);
  await pg.exec(MIGRATION); // safe to re-run
  act = await import("@/app/(masters)/master-setup/incentive-rules/actions");
  rules = await import("@/lib/queries/incentive-rules");
  thisMonth = rules.currentMonthStartIST();
}, 120_000);
afterAll(async () => {
  await pg.close();
});
beforeEach(() => signIn("editor"));

describe("migration 0131 itself", () => {
  it("creates its seven tables, all with row-level security, and leaves the existing tracker's records exactly as they were", async () => {
    const t = await q1<{ relname: string; rls: boolean }>(`select relname, relrowsecurity as rls from pg_class where relname like 'incentive_config_%' or relname = 'incentive_programs' and relkind = 'r' order by 1`);
    expect(t.filter((x) => !x.relname.endsWith("_seq") && !x.relname.endsWith("_idx") && !x.relname.endsWith("_uq") && !x.relname.endsWith("_pkey")).map((x) => [x.relname, x.rls])).toEqual([
      ["incentive_config_delay_steps", true], ["incentive_config_eligibility", true], ["incentive_config_history", true], ["incentive_config_settings", true], ["incentive_config_slabs", true], ["incentive_config_versions", true], ["incentive_programs", true],
    ]);
    expect(await trackerFingerprint()).toEqual(trackerBefore);
    expect((await q1<{ n: number }>(`select count(*)::int n from incentive_programs`))[0]!.n).toBe(0); // nothing seeded
  });
});

describe("rights (Field Permissions, never implied by admin status)", () => {
  it("a non-admin, an admin with no grant and a viewer can't change anything; nothing is written", async () => {
    signIn("staff");
    await expect(act.createIncentiveProgram({ code: "X1", name: "X", description: null })).rejects.toThrow("Forbidden");
    signIn("plainAdmin");
    await expect(act.createIncentiveProgram({ code: "X1", name: "X", description: null })).rejects.toThrow("Forbidden");
    signIn("viewer");
    await expect(act.createIncentiveProgram({ code: "X1", name: "X", description: null })).rejects.toThrow("Forbidden");
    expect((await q1<{ n: number }>(`select count(*)::int n from incentive_programs`))[0]!.n).toBe(0);
    const { incentiveRuleRights } = await import("@/lib/auth/incentive-rules");
    const rightsOf = async (k: Who) => incentiveRuleRights({ ...(await q1(`select * from employees where id = $1`, [who[k]]))[0], id: who[k], email: `${k.toLowerCase()}@example.test`, isAdmin: k !== "staff", isActive: true } as never);
    expect(await rightsOf("plainAdmin")).toEqual({ view: false, edit: false, submit: false, approve: false, publish: false, backdate: false, history: false });
    expect(await rightsOf("editor")).toMatchObject({ view: true, edit: true, submit: true, approve: false, publish: false });
    expect(await rightsOf("root")).toEqual({ view: true, edit: true, submit: true, approve: true, publish: true, backdate: true, history: true });
  });

  it("the seven permissions are sensitive, off by default and not given to admins automatically", async () => {
    const { PERMISSION_FIELDS } = await import("@/db/enums");
    const ours = PERMISSION_FIELDS.filter((f) => f.key.startsWith("incentive.rules."));
    expect(ours.map((f) => f.key)).toEqual(["incentive.rules.view", "incentive.rules.edit", "incentive.rules.submit", "incentive.rules.approve", "incentive.rules.publish", "incentive.rules.backdate", "incentive.rules.history"]);
    for (const f of ours) expect(f, f.key).toMatchObject({ defaultAllowed: false, sensitive: true, adminBypass: false, superAdminBypass: false });
  });
});

let programId = "";
let v1 = "";

describe("drafts", () => {
  it("a programme is created once per code; a draft starts from the reference template with every business decision empty", async () => {
    const p = await act.createIncentiveProgram({ code: "sales-bh", name: "Sales BH", description: "Sample programme" });
    expect(p).toMatchObject({ ok: true });
    programId = (p as { programId: string }).programId;
    expect(await act.createIncentiveProgram({ code: "SALES-BH", name: "Again", description: null })).toEqual({ ok: false, error: expect.stringMatching(/already a programme with code SALES-BH/) });
    expect(await act.createIncentiveDraft({ programId, category: "B", startFrom: "blank" })).toEqual({ ok: false, error: expect.stringMatching(/Category B has no specification yet/) });
    const d = await act.createIncentiveDraft({ programId, category: "A", startFrom: "reference" });
    expect(d).toMatchObject({ ok: true });
    v1 = (d as { versionId: string }).versionId;
    expect(await version(v1)).toMatchObject({ status: "draft", row_version: 1, created_by_id: who.editor });
    const cfg = await rules.loadConfig(h.db as never, v1);
    expect(cfg.slabs).toHaveLength(3);
    expect(cfg.settings["allocation.method"]).toBeUndefined();
    expect((await historyOf(v1)).map((x) => x.action)).toEqual(["create"]);
  });

  it("a draft saves while incomplete, never while wrong; an unknown setting is refused before it is looked at", async () => {
    const cfg = await rules.loadConfig(h.db as never, v1);
    const saved = await act.saveIncentiveDraft({ versionId: v1, expectedRowVersion: 1, config: { ...cfg, settings: { ...cfg.settings, "allocation.method": "equalPerOrder" } }, changeNote: "First choice" });
    expect(saved).toMatchObject({ ok: true, rowVersion: 2 });
    expect((saved as { missing: number }).missing).toBeGreaterThan(10);
    const overlap = { ...cfg, slabs: [cfg.slabs[0]!, { ...cfg.slabs[1]!, fromPaise: cfg.slabs[0]!.toPaise - 1 }] };
    expect(await act.saveIncentiveDraft({ versionId: v1, expectedRowVersion: 2, config: overlap, changeNote: null })).toEqual({ ok: false, error: expect.stringMatching(/overlap/) });
    expect(await act.saveIncentiveDraft({ versionId: v1, expectedRowVersion: 2, config: { ...cfg, settings: { "drop table employees": "x" } }, changeNote: null })).toEqual({ ok: false, error: expect.stringMatching(/isn't an Incentive Rules setting/) });
    expect(await rv(v1)).toBe(2); // the refused saves changed nothing
    // An eligibility row naming someone who doesn't exist is refused.
    const ghost = completeConfig({}, [{ subjectType: "employee", subjectId: "00000000-0000-4000-8000-000000000000", role: null, subjectLabel: "Nobody", mode: "include", effectiveFrom: "2026-04-01", effectiveTo: null }]);
    expect(await act.saveIncentiveDraft({ versionId: v1, expectedRowVersion: 2, config: ghost, changeNote: null })).toEqual({ ok: false, error: "No longer exists: Nobody." });
  });

  it("can't be submitted while anything required is missing", async () => {
    expect(await act.submitIncentiveVersion({ versionId: v1, expectedRowVersion: 2 })).toEqual({ ok: false, error: expect.stringMatching(/isn't complete: .*isn't set/) });
    expect((await version(v1)).status).toBe("draft");
  });

  it("concurrent saves: exactly one of two at the same row version wins; a stale screen is refused", async () => {
    const cfg = await rules.loadConfig(h.db as never, v1);
    const a = { ...cfg, settings: { ...cfg.settings, "rounding.method": "halfUp" } };
    const b = { ...cfg, settings: { ...cfg.settings, "rounding.method": "down" } };
    const [x, y] = await Promise.all([act.saveIncentiveDraft({ versionId: v1, expectedRowVersion: 2, config: a, changeNote: null }), act.saveIncentiveDraft({ versionId: v1, expectedRowVersion: 2, config: b, changeNote: null })]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(await rv(v1)).toBe(3);
    expect(await act.saveIncentiveDraft({ versionId: v1, expectedRowVersion: 2, config: a, changeNote: null })).toEqual({ ok: false, error: expect.stringMatching(/changed by someone else meanwhile/) });
  });
});

describe("approval (maker-checker)", () => {
  it("someone who edited a version can't approve it, though they hold the right; the database refuses the author too", async () => {
    signIn("editorApprover");
    expect(await act.saveIncentiveDraft({ versionId: v1, expectedRowVersion: await rv(v1), config: completeConfig(), changeNote: "Completed" })).toMatchObject({ ok: true, missing: 0 });
    signIn("editor");
    expect(await act.submitIncentiveVersion({ versionId: v1, expectedRowVersion: await rv(v1) })).toMatchObject({ ok: true });
    expect((await version(v1)).status).toBe("submitted");
    signIn("editorApprover");
    expect(await act.approveIncentiveVersion({ versionId: v1, expectedRowVersion: await rv(v1), note: null })).toEqual({ ok: false, error: expect.stringMatching(/can't approve a version you created, edited or submitted/) });
    signIn("editor");
    await expect(act.approveIncentiveVersion({ versionId: v1, expectedRowVersion: await rv(v1), note: null })).rejects.toThrow("Forbidden"); // no approve right
    // Even bypassing the application, the database refuses the author or the submitter as approver.
    await expect(pg.query(`update incentive_config_versions set status = 'approved', approved_by_id = created_by_id, approved_at = now() where id = $1`, [v1])).rejects.toThrow(/approver_check/);
    await expect(pg.query(`update incentive_config_versions set status = 'approved', approved_by_id = submitted_by_id, approved_at = now() where id = $1`, [v1])).rejects.toThrow(/approver_check/);
    signIn("approver");
    expect(await act.approveIncentiveVersion({ versionId: v1, expectedRowVersion: await rv(v1), note: "Matches the PDF" })).toMatchObject({ ok: true });
    expect(await version(v1)).toMatchObject({ status: "approved", approved_by_id: who.approver });
  });

  it("a rejection needs a reason; a rejected version is edited (back to draft) and resubmitted", async () => {
    signIn("editor");
    const d = (await act.createIncentiveDraft({ programId, category: "A", startFrom: { versionId: v1 } })) as { versionId: string };
    const v2 = d.versionId;
    expect(await act.submitIncentiveVersion({ versionId: v2, expectedRowVersion: 1 })).toMatchObject({ ok: true });
    signIn("approver");
    expect(await act.rejectIncentiveVersion({ versionId: v2, expectedRowVersion: 2, note: "  " })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason/) });
    expect(await act.rejectIncentiveVersion({ versionId: v2, expectedRowVersion: 2, note: "Rounding must be to whole rupees" })).toMatchObject({ ok: true });
    expect(await q1(`select status, rejection_reason from incentive_config_versions where id = $1`, [v2])).toEqual([{ status: "rejected", rejection_reason: "Rounding must be to whole rupees" }]);
    signIn("editor");
    const cfg = await rules.loadConfig(h.db as never, v2);
    expect(await act.saveIncentiveDraft({ versionId: v2, expectedRowVersion: 3, config: { ...cfg, settings: { ...cfg.settings, "rounding.precision": "rupee" } }, changeNote: "As asked" })).toMatchObject({ ok: true });
    expect((await version(v2)).status).toBe("draft");
    expect(await act.submitIncentiveVersion({ versionId: v2, expectedRowVersion: 4 })).toMatchObject({ ok: true });
    expect((await historyOf(v2)).map((x) => x.action)).toEqual(["create", "submit", "reject", "edit", "submit"]);
    // An approved version can go back to draft; its approval is cleared.
    signIn("approver");
    expect(await act.approveIncentiveVersion({ versionId: v2, expectedRowVersion: 5, note: null })).toMatchObject({ ok: true });
    signIn("editor");
    expect(await act.returnIncentiveVersionToDraft({ versionId: v2, expectedRowVersion: 6 })).toMatchObject({ ok: true });
    expect(await version(v2)).toMatchObject({ status: "draft", approved_by_id: null });
    expect(await act.discardIncentiveVersion({ versionId: v2, expectedRowVersion: 7 })).toMatchObject({ ok: true });
    expect((await version(v2)).status).toBe("discarded");
  });
});

let v3 = "";
describe("publishing and effective dates", () => {
  it("only from the first of a month; the publish right is needed; an earlier month needs the back-dating right", async () => {
    signIn("approver");
    await expect(act.publishIncentiveVersion({ versionId: v1, expectedRowVersion: await rv(v1), effectiveFrom: monthAdd(thisMonth, 1) })).rejects.toThrow("Forbidden");
    signIn("publisher");
    expect(await act.publishIncentiveVersion({ versionId: v1, expectedRowVersion: await rv(v1), effectiveFrom: `${monthAdd(thisMonth, 1).slice(0, 8)}15` })).toEqual({ ok: false, error: "Choose the month it takes effect from." });
    expect(await act.publishIncentiveVersion({ versionId: v1, expectedRowVersion: await rv(v1), effectiveFrom: monthAdd(thisMonth, -1) })).toEqual({ ok: false, error: expect.stringMatching(/needs the “Incentive Rules — Publish from an earlier month” permission/) });
    expect(await act.publishIncentiveVersion({ versionId: v1, expectedRowVersion: await rv(v1), effectiveFrom: monthAdd(thisMonth, 1) })).toMatchObject({ ok: true, superseded: null });
    expect(await version(v1)).toMatchObject({ status: "published", effective_from: monthAdd(thisMonth, 1), effective_to: null });
  });

  it("a later version ends the one in force the day before it starts; publishing into an earlier period is refused", async () => {
    signIn("editor");
    v3 = ((await act.createIncentiveDraft({ programId, category: "A", startFrom: { versionId: v1 } })) as { versionId: string }).versionId;
    expect(await act.submitIncentiveVersion({ versionId: v3, expectedRowVersion: 1 })).toMatchObject({ ok: true });
    signIn("approver");
    expect(await act.approveIncentiveVersion({ versionId: v3, expectedRowVersion: 2, note: null })).toMatchObject({ ok: true });
    signIn("backdater");
    expect(await act.publishIncentiveVersion({ versionId: v3, expectedRowVersion: 3, effectiveFrom: monthAdd(thisMonth, 1) })).toEqual({ ok: false, error: expect.stringMatching(/already published from/) });
    expect(await act.publishIncentiveVersion({ versionId: v3, expectedRowVersion: 3, effectiveFrom: thisMonth })).toEqual({ ok: false, error: expect.stringMatching(/already published from/) });
    const from = monthAdd(thisMonth, 3);
    expect(await act.publishIncentiveVersion({ versionId: v3, expectedRowVersion: 3, effectiveFrom: from })).toMatchObject({ ok: true, superseded: v1 });
    expect(await version(v1)).toMatchObject({ status: "published", effective_from: monthAdd(thisMonth, 1), effective_to: (await q1<{ d: string }>(`select ($1::date - 1)::text d`, [from]))[0]!.d });
    expect(await version(v3)).toMatchObject({ status: "published", effective_from: from, effective_to: null });
    // Which version applies to which month.
    const forMonth = async (m: string) => (await rules.versionInForce(h.db as never, programId, "A", m))?.id ?? null;
    expect([await forMonth(thisMonth), await forMonth(monthAdd(thisMonth, 1)), await forMonth(monthAdd(thisMonth, 2)), await forMonth(from)]).toEqual([null, v1, v1, v3]);
    expect((await historyOf(v1)).map((x) => x.action).slice(-2)).toEqual(["publish", "supersede"]);
  });

  it("back-dating with the right, in a new programme", async () => {
    signIn("editor");
    const p2 = ((await act.createIncentiveProgram({ code: "OTHER", name: "Other team", description: null })) as { programId: string }).programId;
    const v = ((await act.createIncentiveDraft({ programId: p2, category: "A", startFrom: "blank" })) as { versionId: string }).versionId;
    expect(await act.saveIncentiveDraft({ versionId: v, expectedRowVersion: 1, config: completeConfig(), changeNote: null })).toMatchObject({ ok: true });
    expect(await act.submitIncentiveVersion({ versionId: v, expectedRowVersion: 2 })).toMatchObject({ ok: true });
    signIn("approver");
    expect(await act.approveIncentiveVersion({ versionId: v, expectedRowVersion: 3, note: null })).toMatchObject({ ok: true });
    signIn("backdater");
    expect(await act.publishIncentiveVersion({ versionId: v, expectedRowVersion: 4, effectiveFrom: monthAdd(thisMonth, -2) })).toMatchObject({ ok: true });
    expect((await historyOf(v)).at(-1)).toMatchObject({ action: "publish", note: `Back-dated to ${monthAdd(thisMonth, -2)}.` });
  });
});

describe("what never changes", () => {
  it("a published version, its settings, slabs, steps and eligibility; versions and programmes are never deleted; dates never overlap", async () => {
    const refused = (sql: string, params: unknown[] = []) => expect(pg.query(sql, params)).rejects.toThrow();
    await refused(`update incentive_config_versions set change_note = 'quietly' where id = $1`, [v1]);
    await refused(`update incentive_config_versions set effective_to = '2099-01-31' where id = $1`, [v1]); // already ended
    await refused(`update incentive_config_versions set status = 'draft' where id = $1`, [v3]);
    await refused(`update incentive_config_settings set value = '"flat"' where version_id = $1 and setting_key = 'slabs.method'`, [v3]);
    await refused(`delete from incentive_config_slabs where version_id = $1`, [v3]);
    await refused(`insert into incentive_config_delay_steps (version_id, position, from_days, multiplier_ppm) values ($1, 9, 0, 0)`, [v3]);
    await refused(`update incentive_config_eligibility set mode = 'exclude' where version_id = $1`, [v3]);
    await refused(`delete from incentive_config_versions where id = $1`, [v3]);
    await refused(`delete from incentive_programs where id = $1`, [programId]);
    await refused(`insert into incentive_config_versions (program_id, category_code, version_no, status) values ($1, 'A', 99, 'published')`, [programId]);
    await refused(`update incentive_config_history set note = 'rewritten' where version_id = $1`, [v1]);
    await refused(`delete from incentive_config_history where version_id = $1`, [v1]);
    // A second published version covering the same days, even written directly, is refused.
    signIn("editor");
    const v = ((await act.createIncentiveDraft({ programId, category: "A", startFrom: { versionId: v3 } })) as { versionId: string }).versionId;
    expect(await act.submitIncentiveVersion({ versionId: v, expectedRowVersion: 1 })).toMatchObject({ ok: true });
    signIn("approver");
    expect(await act.approveIncentiveVersion({ versionId: v, expectedRowVersion: 2, note: null })).toMatchObject({ ok: true });
    await expect(pg.query(`update incentive_config_versions set status = 'published', effective_from = $2, published_at = now() where id = $1`, [v, monthAdd(thisMonth, 4)])).rejects.toThrow(/already covers some of these dates/);
    expect((await version(v)).status).toBe("approved");
  });

  it("the history holds every change with who made it and the before and after", async () => {
    const hist = await historyOf(v1);
    expect(hist.map((x) => x.action)).toEqual(["create", "edit", "edit", "edit", "submit", "approve", "publish", "supersede"]);
    expect(hist.map((x) => x.actor_name)).toEqual(["editor", "editor", "editor", "editorApprover", "editor", "approver", "publisher", "backdater"]);
    const firstEdit = hist[1]!;
    expect(firstEdit.before!.config!.settings["allocation.method"]).toBeUndefined();
    expect(firstEdit.after!.config!.settings["allocation.method"]).toBe("equalPerOrder");
    expect(firstEdit.note).toBe("First choice");
    expect(hist[5]!.note).toBe("Matches the PDF");
    const { diffConfigs } = await import("@/lib/incentives/rules-config/validate");
    expect(diffConfigs(hist[3]!.before!.config!, hist[3]!.after!.config!).length).toBeGreaterThan(5);
  });

  it("reading (the list, a version, a preview's data) writes nothing", async () => {
    const counts = async () => q1(`select (select count(*)::int from incentive_config_versions) v, (select count(*)::int from incentive_config_history) h, (select count(*)::int from incentive_config_settings) s`);
    const before = await counts();
    await rules.listProgramsWithVersions(h.db as never);
    await rules.getVersion(v1, h.db as never);
    await rules.versionInForce(h.db as never, programId, "A", thisMonth);
    expect(await counts()).toEqual(before);
  });

  it("deleting an employee who wrote, approved and published versions still works; their references become empty, nothing else changes", async () => {
    const snap = async () => q1(`select id, status, effective_from::text, effective_to::text, row_version from incentive_config_versions order by id`);
    const before = await snap();
    await pg.query(`delete from field_permission_grants where subject_id = $1`, [who.approver]);
    await pg.query(`delete from employees where id = $1`, [who.approver]);
    expect(await snap()).toEqual(before);
    expect((await version(v1)).approved_by_id).toBeNull();
    expect((await q1<{ n: number }>(`select count(*)::int n from incentive_config_history where actor_name = 'approver' and actor_id is null`))[0]!.n).toBeGreaterThan(0);
  });

  it("the existing Incentive Tracker's records are exactly as they were before 0131 and every change above", async () => {
    expect(await trackerFingerprint()).toEqual(trackerBefore);
  });
});
