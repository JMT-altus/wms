// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";

// Collection Logs (read-only). MOCKED session, resolved grants and queries:
// these prove the server-side gates, the empty / not-set-up / error states, IST
// rendering, that restricted history needs its own capability, and that nothing
// on the page can change data. Real SQL for 0119 is covered in
// tests/integration/collection-closures-migration.db.test.ts.
const h = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string },
  caps: new Set<string>(),
  q: {
    listClosures: vi.fn(),
    getClosure: vi.fn(),
    listCompanyClosures: vi.fn(),
    listCommitmentHistory: vi.fn(),
    listConfirmationHistory: vi.fn(),
    listEscalationHistory: vi.fn(),
  },
  listFollowUps: vi.fn(),
}));

vi.mock("server-only", () => ({}));
// Company visibility (lib/collections/scope-server.ts) is not under test here: every company is in scope. The real
// resolver, over real coordinator links, is covered by tests/integration/collection-tracker-scope.db.test.ts.
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => ({ kind: "all" }) }));
// Collection is its own module now (Admin → Access). Its gate is mocked to follow the session's admin flag — the
// admin bypass — so these tests keep exercising the collection.* capabilities exactly as before.
vi.mock("@/lib/auth/module-access", async () => {
  const { getCurrentEmployee } = await import("@/lib/auth/current");
  const inModule = async () => {
    const me = (await getCurrentEmployee()) as { isActive?: boolean; isAdmin?: boolean } | null;
    return !!me && me.isActive !== false && me.isAdmin === true;
  };
  return {
    canAccessModule: inModule,
    requireModuleAccess: async () => {
      const me = await getCurrentEmployee();
      if (!(await inModule())) throw new Error("Forbidden");
      return me;
    },
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  usePathname: () => "/collection/logs",
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries([...h.caps].map((k) => [k, { allowed: true, source: "employee" }])),
}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => () => { throw new Error("the database must not be reached"); } }) }));
vi.mock("@/lib/queries/collection-closures", () => h.q);
vi.mock("@/lib/queries/collection-followups", () => ({ listFollowUps: h.listFollowUps }));

import LogsPage from "@/app/(collection-module)/collection/logs/page";
import LogPage from "@/app/(collection-module)/collection/logs/[closureId]/page";
import { CollectionLogsList, CollectionLogDetail, LOGS_EMPTY_MESSAGE, exactAmount } from "@/components/collections/collection-logs";
import { navFor } from "@/components/collections/collection-sidebar";
import { isSensitivePermission, permissionFieldDef } from "@/db/enums";
import { FIELD_CODE_DEFAULTS, resolveFieldAccess } from "@/lib/access/field-permissions";
import type { ClosureRow } from "@/lib/queries/collection-closures";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const ID = "22222222-2222-4222-8222-222222222222";
const COMPANY = "11111111-1111-4111-8111-111111111111";
const ADMIN = { id: "e-1", email: "a@example.test", isActive: true, isAdmin: true, name: "Admin" };

// 08:05 UTC = 01:35 PM IST on the same day.
const closure = (over: Partial<ClosureRow> = {}): ClosureRow => ({
  id: ID,
  companyId: COMPANY,
  companyName: "Alpha Traders",
  collectionPerson: "North desk",
  closedAt: new Date("2026-10-27T08:05:00Z"),
  closeReason: "outstanding_zero",
  closeSourceKey: "approved_source",
  closeSourceRef: "snap-42",
  finalOutstanding: "0.00",
  finalDebit: "125000.50",
  finalCredit: "125000.50",
  asOfDate: "2026-10-26",
  closedByName: null,
  reopenedAt: null,
  reopenReason: null,
  reopenSourceRef: null,
  reopenedByName: null,
  ...over,
});
const emptyHistory = { comments: null, confirmations: null, commitments: null, escalations: null };
const renderPage = async (el: Promise<ReactElement>) => render(await el);
const notFound = async (p: Promise<unknown>) => {
  await expect(p).rejects.toThrow("NEXT_NOT_FOUND");
};

beforeEach(() => {
  h.me = { ...ADMIN };
  h.caps = new Set(["collection.logs.view"]);
  for (const f of Object.values(h.q)) f.mockReset();
  h.listFollowUps.mockReset();
  h.q.listClosures.mockResolvedValue({ storageReady: true, rows: [] });
  h.q.getClosure.mockResolvedValue({ storageReady: true, row: closure() });
  h.q.listCompanyClosures.mockResolvedValue([closure()]);
});
afterEach(cleanup);

describe("collection.logs.view — the permission", () => {
  it("is registered as an ordinary Collection capability (admin default; explicit deny wins; no grant for non-admins)", () => {
    expect(permissionFieldDef("collection.logs.view")).toMatchObject({ defaultAllowed: false, group: "Collections" });
    expect(isSensitivePermission("collection.logs.view")).toBe(false);
    const none = { everyone: {}, department: {}, employee: {} };
    expect(FIELD_CODE_DEFAULTS["collection.logs.view"]).toBe(false);
    expect(resolveFieldAccess("collection.logs.view", { isAdmin: true, isSuperAdmin: false }, none)).toEqual({ allowed: true, source: "admin" });
    expect(resolveFieldAccess("collection.logs.view", { isAdmin: false, isSuperAdmin: false }, none).allowed).toBe(false);
    const denied = { everyone: {}, department: {}, employee: { "collection.logs.view": false } };
    expect(resolveFieldAccess("collection.logs.view", { isAdmin: true, isSuperAdmin: false }, denied).allowed).toBe(false);
  });
});

describe("Collection Logs page — access", () => {
  it("is 'not found' without collection.logs.view, and reads nothing", async () => {
    h.caps = new Set(["collection.view", "collection.commitments.view", "collection.escalation.review"]);
    await notFound(LogsPage());
    expect(h.q.listClosures).not.toHaveBeenCalled();
  });

  it("is 'not found' for a signed-out, inactive or non-admin employee even with the grant", async () => {
    h.me = null;
    await notFound(LogsPage());
    h.me = { ...ADMIN, isActive: false };
    await notFound(LogsPage());
    h.me = { ...ADMIN, isAdmin: false };
    await notFound(LogsPage());
    expect(h.q.listClosures).not.toHaveBeenCalled();
  });

  it("the detail page is gated the same way, before the id is even looked at", async () => {
    h.caps = new Set();
    await notFound(LogPage({ params: Promise.resolve({ closureId: ID }) }));
    expect(h.q.getClosure).not.toHaveBeenCalled();
  });

  it("the detail page is 'not found' for a malformed or unknown id", async () => {
    await notFound(LogPage({ params: Promise.resolve({ closureId: "../../etc" }) }));
    expect(h.q.getClosure).not.toHaveBeenCalled();
    h.q.getClosure.mockResolvedValue({ storageReady: true, row: null });
    await notFound(LogPage({ params: Promise.resolve({ closureId: ID }) }));
  });

  it("the navigation shows Collection Logs only when the server says so", () => {
    const hrefs = (items: ReadonlyArray<{ href: string }>) => items.map((i) => String(i.href));
    expect(hrefs(navFor(false, true))).not.toContain("/collection/logs");
    expect(hrefs(navFor(true, true))).not.toContain("/collection/logs");
    expect(hrefs(navFor(false, true, true))).toContain("/collection/logs");
    expect(hrefs(navFor(true, true, true)).slice(-2)).toEqual(["/collection/commitments", "/collection/logs"]);
    expect(hrefs(navFor(false, false, true))).toContain("/collection/logs");
    const layout = read("app/(collection-module)/collection/layout.tsx");
    expect(layout).toMatch(/showLogs = caps\["collection\.logs\.view"\]/);
  });
});

describe("Collection Logs page — states", () => {
  it("empty: says honestly that nothing has been closed and why", async () => {
    await renderPage(LogsPage());
    expect(screen.getByText(LOGS_EMPTY_MESSAGE)).toBeTruthy();
    expect(LOGS_EMPTY_MESSAGE).toMatch(/moves here automatically when a confirmed Bulk Upload gives it ₹0 Debit and ₹0 Credit/);
    expect(document.querySelector("table")).toBeNull();
  });

  it("not set up: 0119 pending is stated, with the empty state", async () => {
    h.q.listClosures.mockResolvedValue({ storageReady: false, rows: [] });
    await renderPage(LogsPage());
    expect(screen.getByRole("status").textContent).toMatch(/migration 0119 is pending/);
    expect(screen.getByText(LOGS_EMPTY_MESSAGE)).toBeTruthy();
  });

  it("load failure: a plain message with no details", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.q.listClosures.mockRejectedValue(new Error("connect ECONNREFUSED secret-host:5432"));
    await renderPage(LogsPage());
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(document.body.textContent).not.toMatch(/ECONNREFUSED|secret-host/);
    expect(err.mock.calls.flat().join(" ")).not.toMatch(/secret-host/);
    err.mockRestore();
  });

  it("lists episodes with IST time, reason, exact final outstanding, source and status", async () => {
    h.q.listClosures.mockResolvedValue({
      storageReady: true,
      rows: [
        closure(),
        closure({ id: "33333333-3333-4333-8333-333333333333", companyName: "Beta Works", reopenedAt: new Date("2026-10-27T18:40:00Z"), reopenReason: "outstanding_positive" }),
      ],
    });
    await renderPage(LogsPage());
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const a = within(rows[0]!);
    expect(a.getByRole("link", { name: "Alpha Traders" }).getAttribute("href")).toBe(`/collection/logs/${ID}`);
    expect(rows[0]!.textContent).toContain("27/10/26 · 01:35 PM IST");
    expect(rows[0]!.textContent).toContain("Debit and Credit both zero");
    expect(rows[0]!.textContent).toContain("₹0");
    expect(rows[0]!.textContent).toContain("approved_source");
    expect(rows[0]!.textContent).toContain("snap-42");
    expect(rows[0]!.querySelector("[data-closure-status]")?.getAttribute("data-closure-status")).toBe("closed");
    // 18:40 UTC is 12:10 AM IST the NEXT day.
    expect(rows[1]!.querySelector("[data-closure-status]")?.getAttribute("data-closure-status")).toBe("reopened");
    expect(rows[1]!.textContent).toContain("28/10/26 · 12:10 AM IST");
  });

  it("shows money exactly, keeping a sign the source wrote", () => {
    expect(exactAmount("0.00")).toBe("₹0");
    expect(exactAmount("31185501.28")).toBe("₹3,11,85,501.28");
    expect(exactAmount("-12.50")).toBe("-₹12.50");
  });
});

describe("Collection Log detail — existing history, read-only", () => {
  const escalations = {
    storageReady: true,
    reasonStorageReady: true,
    rows: [
      { id: "e2", status: "open" as const, escalatedAt: new Date("2026-10-20T05:00:00Z"), escalatedByName: "Ravi", confirmationAtEscalation: "no" as const, closedAt: null, closedByName: null, reason: "Customer disputes the invoice" },
      { id: "e1", status: "closed" as const, escalatedAt: new Date("2026-09-01T05:00:00Z"), escalatedByName: null, confirmationAtEscalation: null, closedAt: new Date("2026-09-02T05:00:00Z"), closedByName: "Reviewer A", reason: null },
    ],
  };
  const commitments = { storageReady: true, rows: [{ id: "c1", amount: "50000.00", committedDate: "2026-11-05", recordedAt: new Date("2026-10-21T06:30:00Z"), recordedByName: "Ravi" }] };

  it("loads each restricted part only with its own capability (logs.view alone shows the closure only)", async () => {
    await renderPage(LogPage({ params: Promise.resolve({ closureId: ID }) }));
    expect(h.q.listCommitmentHistory).not.toHaveBeenCalled();
    expect(h.q.listEscalationHistory).not.toHaveBeenCalled();
    expect(h.q.listConfirmationHistory).not.toHaveBeenCalled();
    expect(h.listFollowUps).not.toHaveBeenCalled();
    expect(document.querySelector('[data-log-section="closure"]')).toBeTruthy();
    for (const s of ["comments", "confirmations", "commitments", "escalations"]) expect(document.querySelector(`[data-log-section="${s}"]`)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Escalat|Commitment/);
  });

  it("with the capabilities, shows comments, confirmations, commitments and escalations (open ones kept open, with reasons)", async () => {
    h.caps = new Set(["collection.logs.view", "collection.view", "collection.commitments.view", "collection.escalation.review"]);
    h.listFollowUps.mockResolvedValue({
      storageReady: true,
      entries: [
        { id: "f1", partyName: "alpha traders ", nextFollowupDate: null, note: "Paid in full", createdById: "e-9", createdByName: "Ravi", createdAt: new Date("2026-10-26T04:00:00Z") },
        { id: "f2", partyName: "Other Co", nextFollowupDate: null, note: "Not this company", createdById: "e-9", createdByName: "Ravi", createdAt: new Date("2026-10-26T04:00:00Z") },
      ],
    });
    h.q.listConfirmationHistory.mockResolvedValue({ storageReady: true, rows: [{ id: "k1", value: "yes", recordedAt: new Date("2026-10-25T04:00:00Z"), recordedByName: "Ravi" }] });
    h.q.listCommitmentHistory.mockResolvedValue(commitments);
    h.q.listEscalationHistory.mockResolvedValue(escalations);
    await renderPage(LogPage({ params: Promise.resolve({ closureId: ID }) }));
    expect(h.q.listCommitmentHistory).toHaveBeenCalledWith(expect.objectContaining({ capability: "collection.commitments.view" }), COMPANY);
    expect(h.q.listEscalationHistory).toHaveBeenCalledWith(expect.objectContaining({ capability: "collection.escalation.review" }), COMPANY);
    const section = (s: string) => document.querySelector(`[data-log-section="${s}"]`)!.textContent!;
    expect(section("comments")).toContain("Paid in full");
    expect(section("comments")).not.toContain("Not this company");
    expect(section("confirmations")).toContain("Yes");
    expect(section("commitments")).toContain("₹50,000");
    expect(section("commitments")).toContain("05/11/26");
    expect(section("escalations")).toContain("Customer disputes the invoice");
    expect(section("escalations")).toContain("Escalated by: Ravi · 20/10/26 · 10:30 AM IST");
    expect(section("escalations")).toMatch(/No reason recorded/);
    expect(document.querySelector('[data-escalation-status="open"]')).toBeTruthy();
    expect(document.querySelector('[data-escalation-status="closed"]')).toBeTruthy();
  });

  it("has no control that could change anything: no buttons, forms or inputs", () => {
    render(
      <CollectionLogDetail
        closure={closure({ reopenedAt: new Date("2026-10-28T08:05:00Z"), reopenReason: "outstanding_positive", reopenSourceRef: "snap-43" })}
        episodes={[closure(), closure({ id: "44444444-4444-4444-8444-444444444444" })]}
        history={{ comments: { storageReady: true, entries: [] }, confirmations: { storageReady: true, rows: [] }, commitments, escalations }}
      />,
    );
    expect(document.querySelectorAll("button, form, input, textarea, select")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\b(Reopen now|Close now|Delete|Edit)\b/);
    expect(document.body.textContent).toContain("Debit or Credit no longer zero");
    render(<CollectionLogsList rows={[closure()]} storageReady />);
    expect(document.querySelectorAll("button, form, input, textarea, select")).toHaveLength(0);
  });

  it("states storage that is not set up instead of showing nothing", () => {
    render(
      <CollectionLogDetail
        closure={closure()}
        episodes={[closure()]}
        history={{
          comments: { storageReady: false, entries: [] },
          confirmations: { storageReady: false, rows: [] },
          commitments: { storageReady: false, rows: [] },
          escalations: { storageReady: true, reasonStorageReady: false, rows: escalations.rows },
        }}
      />,
    );
    expect(document.body.textContent).toMatch(/migration 0110, is pending/);
    expect(document.body.textContent).toMatch(/migration 0115 is pending/);
    expect(document.body.textContent).toMatch(/migration 0114 is pending/);
    expect(document.body.textContent).toMatch(/migration 0118 is pending/);
  });

  it("an empty history part says so", () => {
    render(<CollectionLogDetail closure={closure()} episodes={[closure()]} history={{ ...emptyHistory, commitments: { storageReady: true, rows: [] } }} />);
    expect(document.body.textContent).toContain("No commitments recorded.");
  });
});

describe("closures are written in exactly one place: the confirmed Bulk Upload", () => {
  it("the closure queries only read", () => {
    const q = read("lib/queries/collection-closures.ts");
    expect(q).not.toMatch(/\.(insert|update|delete)\(|\bexecute\(|sql`/);
  });

  it("only Collection Logs, the schema, the one writer, the Tracker loader and their tests refer to closures", () => {
    const out = execFileSync("git", ["grep", "--untracked", "-l", "-i", "-E", "collection_closures|collectionClosures|collection-closures"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(out).toEqual(
      [
        "app/(collection-module)/collection/logs/[closureId]/page.tsx",
        "app/(collection-module)/collection/logs/page.tsx",
        "components/collections/collection-logs.tsx",
        "db/migrations/0119_collection_closures.sql",
        "db/schema.ts",
        "lib/queries/collection-closures.ts",
        // The one writer, called only from the confirmed import (below), and the Tracker loader that reads open episodes.
        "lib/queries/collection-closures-write.ts",
        "lib/collections/balances/closures.ts",
        "app/(collection-module)/collection/tracker/bulk-actions.ts",
        "lib/collections/load.ts",
        "tests/integration/collection-closures-migration.db.test.ts",
        "tests/integration/collection-logs-movement.db.test.ts",
        // Tests that mock the loader's or the import's closure modules.
        "tests/unit/collection-balances-actions.test.ts",
        "tests/unit/collection-source.test.ts",
        "tests/unit/collection-zero-outstanding.test.ts",
        "tests/unit/collection-logs.test.tsx",
      ].sort(),
    );
  });

  it("the writer is called once, inside the confirmed import's transaction after its lines; nothing else writes closures", () => {
    const bulk = read("app/(collection-module)/collection/tracker/bulk-actions.ts");
    expect(bulk.match(/applyClosureMovement\(/g)).toHaveLength(1);
    const importFn = bulk.slice(bulk.indexOf("export async function importCollectionBalances"), bulk.indexOf("const AddCompaniesSchema"));
    expect(importFn.indexOf("applyClosureMovement(")).toBeGreaterThan(importFn.indexOf("db.transaction("));
    expect(importFn.indexOf("applyClosureMovement(")).toBeGreaterThan(importFn.indexOf("insert(collectionBalanceLines)"));
    expect(read("lib/queries/collection-closures-write.ts")).not.toMatch(/\.delete\(/);
    expect(read("lib/collections/load.ts")).not.toMatch(/\.(insert|update|delete)\(/);
    for (const f of ["lib/collections/derive.ts", "lib/collections/balances/plan.ts", "app/(collection-module)/collection/commitments/page.tsx", "lib/queries/collection-review.ts"]) {
      expect(read(f), f).not.toMatch(/closure|Closure|logs\.view/);
    }
  });

  it("the backup still includes closures (only restricted-only data is excluded)", () => {
    expect(read("lib/backup/export.ts")).not.toMatch(/collection_closures/);
  });
});
