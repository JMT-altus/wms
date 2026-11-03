import { beforeEach, describe, expect, it, vi } from "vitest";

// The marks server action (setCompanyMarks): the capability is the mark's own and is checked before anything is read;
// only companies in the caller's scope are touched; "already in that state" and out-of-scope ids are counted as
// skipped, never written; the missing table (migration 0125 pending) is reported plainly. Session, grants, scope,
// the loader and the mark queries are mocked.
const h = vi.hoisted(() => ({
  caps: new Set<string>(),
  inScope: [] as string[],
  writes: [] as string[],
  setOutcome: "set" as "set" | "already",
  clearOutcome: "cleared" as "cleared" | "none",
  throwMissing: false,
  revalidated: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/capability", () => ({
  requireCollectionCapability: async (key: string) => {
    if (!h.caps.has(key)) throw new Error("Forbidden");
    return { employeeId: "emp-asha", capability: key };
  },
}));
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => ({ kind: "all" }) }));
vi.mock("@/lib/collections/load", () => ({
  loadCollectionParties: async () => ({ connected: true, masterReady: true, parties: h.inScope.map((id) => ({ masterId: id, partyName: id })) }),
}));
vi.mock("@/lib/queries/collection-master", () => ({ isMissingTable: (e: unknown) => (e as { code?: string })?.code === "42P01" }));
vi.mock("@/lib/queries/collection-marks", () => ({
  setCompanyMark: async (_p: unknown, id: string, kind: string) => {
    if (h.throwMissing) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    h.writes.push(`set:${kind}:${id}`);
    return h.setOutcome;
  },
  clearCompanyMark: async (_p: unknown, id: string, kind: string) => {
    h.writes.push(`clear:${kind}:${id}`);
    return h.clearOutcome;
  },
}));

import { setCompanyMarks } from "@/app/(collection-module)/collection/marks-actions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  h.caps = new Set(["collection.view", "collection.priority.set", "collection.done.set"]);
  h.inScope = [A, B];
  h.writes = [];
  h.setOutcome = "set";
  h.clearOutcome = "cleared";
  h.throwMissing = false;
  h.revalidated = [];
});

describe("setCompanyMarks", () => {
  it("priority needs collection.priority.set and done needs collection.done.set — refused before anything is written", async () => {
    h.caps = new Set(["collection.view", "collection.done.set"]);
    await expect(setCompanyMarks({ companyIds: [A], kind: "priority", active: true })).rejects.toThrow("Forbidden");
    h.caps = new Set(["collection.view", "collection.priority.set"]);
    await expect(setCompanyMarks({ companyIds: [A], kind: "done", active: true })).rejects.toThrow("Forbidden");
    await expect(setCompanyMarks({ companyIds: [A], kind: "done", active: false })).rejects.toThrow("Forbidden");
    expect(h.writes).toEqual([]);
  });

  it("refuses a malformed request without touching anything", async () => {
    expect((await setCompanyMarks({ companyIds: [], kind: "priority", active: true })).ok).toBe(false);
    expect((await setCompanyMarks({ companyIds: [A], kind: "priority", active: true, actorId: "x" })).ok).toBe(false);
    expect((await setCompanyMarks({ companyIds: ["nope"], kind: "done", active: true })).ok).toBe(false);
    expect(h.writes).toEqual([]);
  });

  it("marks every in-scope company once; an id outside the scope is skipped and never written", async () => {
    const res = await setCompanyMarks({ companyIds: [A, B, C, A], kind: "priority", active: true });
    expect(res).toEqual({ ok: true, updated: 2, skipped: 1 });
    expect(h.writes).toEqual([`set:priority:${A}`, `set:priority:${B}`]);
    expect(h.revalidated).toEqual(["/collection/tracker"]);
  });

  it("a company already in the requested state counts as skipped (no second episode), and nothing is revalidated for nothing", async () => {
    h.setOutcome = "already";
    expect(await setCompanyMarks({ companyIds: [A], kind: "done", active: true })).toEqual({ ok: true, updated: 0, skipped: 1 });
    h.clearOutcome = "none";
    expect(await setCompanyMarks({ companyIds: [A], kind: "done", active: false })).toEqual({ ok: true, updated: 0, skipped: 1 });
    expect(h.writes).toEqual([`set:done:${A}`, `clear:done:${A}`]);
    expect(h.revalidated).toEqual([]);
  });

  it("reversing writes a clear, not a delete", async () => {
    expect(await setCompanyMarks({ companyIds: [B], kind: "priority", active: false })).toEqual({ ok: true, updated: 1, skipped: 0 });
    expect(h.writes).toEqual([`clear:priority:${B}`]);
  });

  it("before migration 0125 the missing table is reported plainly", async () => {
    h.throwMissing = true;
    expect(await setCompanyMarks({ companyIds: [A], kind: "priority", active: true })).toEqual({ ok: false, error: expect.stringMatching(/migration 0125/) });
  });
});
