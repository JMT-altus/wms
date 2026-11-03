import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite) of a reviewer's comment on an escalation: escalated through the REAL Tracker
// action, answered through the REAL addEscalationComment action, read back by the REAL Tracker and Escalations pages
// with the real capability resolver over real grant rows. Mocked: who is signed in, and the Collection scope.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => ({ kind: "all" }) }));
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
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let tracker: typeof import("@/app/(collection-module)/collection/actions");
let review: typeof import("@/app/(collection-module)/collection/commitments/actions");
let TrackerPage: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];
let EscalationsPage: (typeof import("@/app/(collection-module)/collection/escalations/page"))["default"];
const ids: Record<string, string> = {};
let ALPHA = "";
let escalationId = "";

const as = (who: "sales" | "reviewer" | "closer" | "other") => (h.me = { id: ids[who]!, isAdmin: false, isActive: true, email: `${who}@example.test`, name: who, departmentId: null });
const token = () => crypto.randomUUID();
function findProps(node: ReactNode, name: string): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if (typeof el.type === "function" && (el.type as { name?: string }).name === name) return el.props;
  const kids = el.props.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const f = findProps(k as ReactNode, name);
    if (f) return f;
  }
  return null;
}
type Entry = { id: string; note: string | null; createdByName: string | null; createdAt: Date; reviewerEscalationId?: string | null };
/** The company's history as the Tracker page sends it (the Comments column and the popup History both render this). */
const history = async () => ((findProps(await TrackerPage(), "CollectionTracker")!.rows as { partyName: string; history: Entry[] }[]).find((r) => r.partyName === "Alpha Traders")!.history);
/** The company's row on the Escalations page. */
const escalationRow = async () => ((findProps(await EscalationsPage(), "CommitmentsTable")!.rows as { companyName: string; comments: Entry[]; escalation: { id: string } | null }[]).find((r) => r.companyName === "Alpha Traders"));
const n = async (q: string, p: unknown[] = []) => Number((await pg.query<{ n: number }>(q, p)).rows[0]!.n);

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    employeeEvents: schema.employeeEvents,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
    collectionFollowups: schema.collectionFollowups,
    collectionAmountConfirmations: schema.collectionAmountConfirmations,
    collectionConfirmedAmounts: schema.collectionConfirmedAmounts,
    collectionEscalations: schema.collectionEscalations,
  });
  pg = made.pg;
  h.db = made.db;
  const emp = async (name: string) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', false) returning id`, [name, `${name}@example.test`])).rows[0]!.id;
  ids.sales = await emp("Sales Person");
  ids.reviewer = await emp("Reviewer One");
  ids.closer = await emp("Closer");
  ids.other = await emp("Other");
  const grant = async (id: string, keys: string[]) => {
    await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [id]);
    for (const key of keys) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, id]);
  };
  await grant(ids.sales!, ["collection.view", "collection.followup.write", "collection.escalation.create"]);
  await grant(ids.reviewer!, ["collection.view", "collection.escalation.review"]);
  await grant(ids.closer!, ["collection.view", "collection.escalation.review", "collection.escalation.close"]);
  await grant(ids.other!, ["collection.view", "collection.followup.write"]);
  ALPHA = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ('Alpha Traders', 'alphatraders', 'MANGESH') returning id`)).rows[0]!.id;
  tracker = await import("@/app/(collection-module)/collection/actions");
  review = await import("@/app/(collection-module)/collection/commitments/actions");
  TrackerPage = (await import("@/app/(collection-module)/collection/tracker/page")).default;
  EscalationsPage = (await import("@/app/(collection-module)/collection/escalations/page")).default;
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("a reviewer answers an escalation", () => {
  it("1: the salesperson comments and escalates; the reviewer sees it on the Escalations page", async () => {
    as("sales");
    expect(await tracker.saveFollowUp({ partyName: "Alpha Traders", nextFollowupDate: "2099-01-15", note: "Customer says the invoice is wrong" })).toEqual({ ok: true });
    expect(await tracker.escalateForReview({ companyId: ALPHA, reason: "Customer disputes the invoice amount." })).toEqual({ ok: true });
    as("reviewer");
    const row = await escalationRow();
    expect(row?.escalation).toBeTruthy();
    escalationId = row!.escalation!.id;
  });

  it("2–6: the saved comment is one row, labelled as the reviewer's, on the Escalations page, in the Tracker comments and in the popup history", async () => {
    as("reviewer");
    const r = await review.addEscalationComment({ escalationId, note: "  Checked with accounts: invoice is correct.  ", token: token() });
    expect(r).toEqual({ ok: true, duplicate: false });
    const tracked = await history();
    const reply = tracked.filter((e) => e.reviewerEscalationId === escalationId);
    expect(reply).toHaveLength(1);
    expect(reply[0]).toMatchObject({ note: "Checked with accounts: invoice is correct.", createdByName: "Reviewer One", reviewerEscalationId: escalationId });
    expect(reply[0]!.createdAt).toBeInstanceOf(Date);
    // The Escalations page shows the same saved row (same id), not a copy.
    const onPage = (await escalationRow())!.comments.filter((c) => c.reviewerEscalationId === escalationId);
    expect(onPage.map((c) => c.id)).toEqual(reply.map((c) => c.id));
    expect(await n(`select count(*)::int n from collection_followups where note = 'Checked with accounts: invoice is correct.'`)).toBe(1);
    // Stored as the signed-in reviewer, with the audit link to its escalation.
    expect(await n(`select count(*)::int n from employee_events where event_type = 'collection_reviewer_comment' and actor_id = $1 and to_value->>'escalationId' = $2`, [ids.reviewer, escalationId])).toBe(1);
  });

  it("7: the salesperson's comment and the escalation reason are untouched, and not labelled as reviewer comments", async () => {
    as("reviewer");
    const original = (await history()).find((e) => e.note === "Customer says the invoice is wrong")!;
    expect(original).toMatchObject({ createdByName: "Sales Person", reviewerEscalationId: null });
    expect((await pg.query(`select reason, status from collection_escalations where id = $1`, [escalationId])).rows).toEqual([{ reason: "Customer disputes the invoice amount.", status: "open" }]);
  });

  it("8 + 9: a second comment is kept beside the first, newest first; neither closes the escalation", async () => {
    as("reviewer");
    expect(await review.addEscalationComment({ escalationId, note: "Sent the signed delivery note.", token: token() })).toEqual({ ok: true, duplicate: false });
    const replies = (await history()).filter((e) => e.reviewerEscalationId === escalationId);
    expect(replies.map((e) => e.note)).toEqual(["Sent the signed delivery note.", "Checked with accounts: invoice is correct."]);
    expect((await pg.query(`select status from collection_escalations where id = $1`, [escalationId])).rows).toEqual([{ status: "open" }]);
    expect((await escalationRow())?.escalation?.id).toBe(escalationId);
  });

  it("repeated clicks (the same dialog's token) save once; empty or over-long comments are refused", async () => {
    as("reviewer");
    const t = token();
    const both = await Promise.all([
      review.addEscalationComment({ escalationId, note: "Double click", token: t }),
      review.addEscalationComment({ escalationId, note: "Double click", token: t }),
    ]);
    expect(both.map((r) => r.ok && r.duplicate).sort()).toEqual([false, true]);
    expect(await n(`select count(*)::int n from collection_followups where note = 'Double click'`)).toBe(1);
    expect(await review.addEscalationComment({ escalationId, note: "   ", token: token() })).toMatchObject({ ok: false, error: "A comment can't be empty." });
    expect(await review.addEscalationComment({ escalationId, note: "x".repeat(2001), token: token() })).toMatchObject({ ok: false });
  });

  it("11: without collection.escalation.review nobody can add one — not the salesperson, not another Tracker user — and nothing is written", async () => {
    const before = await n(`select count(*)::int n from collection_followups`);
    for (const who of ["sales", "other"] as const) {
      as(who);
      await expect(review.addEscalationComment({ escalationId, note: "Not allowed", token: token() })).rejects.toThrow("Forbidden");
    }
    h.me = null;
    await expect(review.addEscalationComment({ escalationId, note: "Not allowed", token: token() })).rejects.toThrow("Forbidden");
    expect(await n(`select count(*)::int n from collection_followups`)).toBe(before);
  });

  it("12: reloading reads the same comments again — none lost, none duplicated", async () => {
    as("reviewer");
    const a = (await history()).map((e) => e.id);
    const b = (await history()).map((e) => e.id);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
    expect((await history()).filter((e) => e.reviewerEscalationId === escalationId)).toHaveLength(3);
  });

  it("10: Close still works on its own (Close permission only); a closed escalation takes no more comments, and its comments stay", async () => {
    as("reviewer");
    await expect(review.closeEscalation({ escalationId })).rejects.toThrow("Forbidden"); // review alone can't close
    as("closer");
    expect(await review.closeEscalation({ escalationId })).toEqual({ ok: true });
    expect(await review.addEscalationComment({ escalationId, note: "Too late", token: token() })).toMatchObject({ ok: false, error: expect.stringMatching(/has been closed/) });
    expect((await history()).filter((e) => e.reviewerEscalationId === escalationId)).toHaveLength(3);
    expect(await review.addEscalationComment({ escalationId: crypto.randomUUID(), note: "Nowhere", token: token() })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
  });
});
