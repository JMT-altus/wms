import { beforeEach, describe, expect, it, vi } from "vitest";

// Undo must skip a whole employee/date once HR has corrected or added any punch on
// it. Database and sign-in are mocked: nothing here touches real data.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  deletedIds: [] as string[][],
  events: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current", () => ({ requireAdmin: async () => ({ id: "99999999-9999-4999-8999-999999999999", isAdmin: true }) }));
// Let the mocked db see the ids handed to inArray() so deletes can be asserted exactly.
vi.mock("drizzle-orm", async (orig) => {
  const m = await orig<typeof import("drizzle-orm")>();
  return {
    ...m,
    inArray: (_c: unknown, v: unknown[]) => ({ __in: v }),
    and: (...a: unknown[]) => ({ __and: a }),
    or: (...a: unknown[]) => ({ __or: a }),
    eq: (_c: unknown, v: unknown) => ({ __eq: v }),
  };
});

function selectChain(): unknown {
  const chain: Record<string, unknown> = {};
  for (const k of ["from", "where", "orderBy", "limit", "for"]) chain[k] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(h.selects.shift() ?? []).then(res);
  return chain;
}
vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => selectChain(),
        delete: () => ({
          where: (cond: { __and?: { __in?: string[] }[] }) => {
            const ids = cond.__and?.[0]?.__in ?? [];
            h.deletedIds.push(ids);
            return { returning: async () => ids.map((id) => ({ id })) };
          },
        }),
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            h.events.push(v);
            return Promise.resolve();
          },
        }),
      }),
  },
}));

import { undoImportBatch } from "@/app/(app)/hr/attendance-import/actions";
import { batchNote, classifyBatchDays, type InventoryPunch, type StoredPunch } from "@/lib/attendance/import/batch";

const BATCH = "33333333-3333-4333-8333-333333333333";
const ACTOR = "99999999-9999-4999-8999-999999999999";
const HR = "88888888-8888-4888-8888-888888888888";
const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const ctx = { batchId: BATCH, actorId: ACTOR };

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

// 10:10 and 19:32 IST on the given day, as the import stores them.
const t = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const invOf = (id: string, date: string, kind: "in" | "out", hhmm: string): InventoryPunch => ({ id, date, kind, at: t(date, hhmm).toISOString() });
/** The stored row exactly as the import wrote it. */
const rowOf = (p: InventoryPunch, employeeId: string, over: Partial<StoredPunch> = {}): StoredPunch => ({
  id: p.id, employeeId, logDate: p.date, kind: p.kind, loggedAt: new Date(p.at), note: batchNote(BATCH),
  source: "admin", reason: "import", recordedById: ACTOR, ...over,
});
/** A punch HR added: not in the batch, with HR's own note. */
const hrAdded = (employeeId: string, date: string, kind: "in" | "out", hhmm: string): StoredPunch => ({
  id: uid(), employeeId, logDate: date, kind, loggedAt: t(date, hhmm), note: "Power cut, machine was off.",
  source: "admin", reason: "power_failure", recordedById: HR,
});
/** The imported punch after HR corrected its time. */
const corrected = (p: InventoryPunch, employeeId: string, hhmm: string): StoredPunch =>
  rowOf(p, employeeId, { loggedAt: t(p.date, hhmm), reason: "power_failure", recordedById: HR, note: `${batchNote(BATCH)} | HR correction: Power cut` });

const D1 = "2026-04-01";
const D2 = "2026-04-02";
const D3 = "2026-04-03";

describe("classifyBatchDays (the day-level rule)", () => {
  const inA = invOf(uid(), D1, "in", "10:10");
  const outA = invOf(uid(), D1, "out", "19:32");

  it("an untouched day: both punches stay removable", () => {
    const r = classifyBatchDays([inA, outA], E1, [rowOf(inA, E1), rowOf(outA, E1)], ctx);
    expect(r.byId.get(inA.id)).toEqual({ state: "intact" });
    expect(r.byId.get(outA.id)).toEqual({ state: "intact" });
    expect(r.touchedDays).toEqual([]);
  });

  it("corrected IN: the IN is modified and the unchanged OUT is kept with it", () => {
    const r = classifyBatchDays([inA, outA], E1, [corrected(inA, E1, "09:45"), rowOf(outA, E1)], ctx);
    expect(r.byId.get(inA.id)!.state).toBe("modified");
    expect(r.byId.get(outA.id)!.state).toBe("kept_day_touched");
    expect(r.touchedDays).toEqual([{ date: D1, why: ["a punch from this import was edited or re-recorded"] }]);
  });

  it("corrected OUT: the OUT is modified and the unchanged IN is kept with it", () => {
    const r = classifyBatchDays([inA, outA], E1, [rowOf(inA, E1), corrected(outA, E1, "18:30")], ctx);
    expect(r.byId.get(outA.id)!.state).toBe("modified");
    expect(r.byId.get(inA.id)!.state).toBe("kept_day_touched");
  });

  it("HR added a punch to an IN-only day: the IN is kept, because the day holds a punch the import did not write", () => {
    const only = invOf(uid(), D2, "in", "10:10");
    const r = classifyBatchDays([only], E1, [rowOf(only, E1), hrAdded(E1, D2, "out", "18:30")], ctx);
    expect(r.byId.get(only.id)!.state).toBe("kept_day_touched");
    expect(r.touchedDays[0]!.why[0]).toMatch(/did not write \(OUT\)/);
  });

  it("does not rely on the note: an unknown punch carrying the batch tag still touches the day", () => {
    const only = invOf(uid(), D2, "in", "10:10");
    const lookalike = { ...hrAdded(E1, D2, "out", "18:30"), note: batchNote(BATCH), reason: "import", recordedById: ACTOR };
    expect(classifyBatchDays([only], E1, [rowOf(only, E1), lookalike], ctx).byId.get(only.id)!.state).toBe("kept_day_touched");
  });

  it("a deleted sibling counts as touching the day", () => {
    const r = classifyBatchDays([inA, outA], E1, [rowOf(inA, E1)], ctx); // the OUT row is gone
    expect(r.byId.get(outA.id)!.state).toBe("missing");
    expect(r.byId.get(inA.id)!.state).toBe("kept_day_touched");
    expect(r.touchedDays[0]!.why[0]).toMatch(/deleted/);
  });

  it("a punch on another date, or for another employee, does not touch this day", () => {
    const r = classifyBatchDays(
      [inA, outA], E1,
      [rowOf(inA, E1), rowOf(outA, E1), hrAdded(E1, D2, "in", "10:00"), hrAdded(E2, D1, "in", "10:00")],
      ctx,
    );
    expect(r.byId.get(inA.id)!.state).toBe("intact");
    expect(r.byId.get(outA.id)!.state).toBe("intact");
    expect(r.touchedDays).toEqual([]);
  });

  it("each day is judged on its own within one person's batch", () => {
    const in2 = invOf(uid(), D2, "in", "10:10");
    const out2 = invOf(uid(), D2, "out", "19:32");
    const r = classifyBatchDays([inA, outA, in2, out2], E1, [rowOf(inA, E1), rowOf(outA, E1), corrected(in2, E1, "09:45"), rowOf(out2, E1)], ctx);
    expect([inA, outA].map((p) => r.byId.get(p.id)!.state)).toEqual(["intact", "intact"]);
    expect(r.byId.get(in2.id)!.state).toBe("modified");
    expect(r.byId.get(out2.id)!.state).toBe("kept_day_touched");
    expect(r.touchedDays.map((d) => d.date)).toEqual([D2]);
  });
});

describe("undoImportBatch: a mixed batch", () => {
  beforeEach(() => {
    h.selects = [];
    h.deletedIds = [];
    h.events = [];
  });

  const importEvent = (employeeId: string, punches: InventoryPunch[]) => ({
    employeeId, actorId: ACTOR, eventType: "attendance_import", createdAt: new Date("2026-10-17T08:00:00Z"),
    toValue: { batchId: BATCH, file: "april.xlsx", inserted: punches.length, from: D1, to: D3, punches },
  });

  it("removes untouched days, skips every day HR touched, and handles each person independently", async () => {
    // Person 1 — day 1: untouched. day 2: IN corrected, OUT untouched. day 3: IN-only, HR added the OUT.
    const a1i = invOf(uid(), D1, "in", "10:10"), a1o = invOf(uid(), D1, "out", "19:32");
    const a2i = invOf(uid(), D2, "in", "10:10"), a2o = invOf(uid(), D2, "out", "19:32");
    const a3i = invOf(uid(), D3, "in", "10:10");
    // Person 2 — day 1: untouched.
    const b1i = invOf(uid(), D1, "in", "09:00"), b1o = invOf(uid(), D1, "out", "17:00");

    h.selects = [
      [importEvent(E1, [a1i, a1o, a2i, a2o, a3i]), importEvent(E2, [b1i, b1o])], // loadBatch
      [rowOf(a1i, E1), rowOf(a1o, E1), corrected(a2i, E1, "09:45"), rowOf(a2o, E1), rowOf(a3i, E1), hrAdded(E1, D3, "out", "18:30")], // person 1, locked
      [rowOf(b1i, E2), rowOf(b1o, E2)], // person 2, locked
    ];
    const res = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Removed: person 1 day 1 (2) + person 2 day 1 (2). Nothing else.
    expect(res.undo).toMatchObject({ removed: 4, keptModified: 1, keptDayTouched: 2, daysSkipped: 2, missing: 0, failedPeople: 0 });
    expect(h.deletedIds).toHaveLength(2);
    expect(new Set(h.deletedIds[0])).toEqual(new Set([a1i.id, a1o.id]));
    expect(new Set(h.deletedIds[1])).toEqual(new Set([b1i.id, b1o.id]));

    const audits = h.events.filter((e) => e.eventType === "attendance_import_undo") as { employeeId: string; toValue: { removedIds: string[]; daysSkipped: number; keptDayTouched: number } }[];
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ employeeId: E1, toValue: { daysSkipped: 2, keptDayTouched: 2 } });
    expect(new Set(audits[0]!.toValue.removedIds)).toEqual(new Set([a1i.id, a1o.id]));
    expect(audits[1]).toMatchObject({ employeeId: E2, toValue: { daysSkipped: 0, keptDayTouched: 0 } });
  });

  it("a person whose every day was touched is left completely alone, with no audit row", async () => {
    const i = invOf(uid(), D1, "in", "10:10"), o = invOf(uid(), D1, "out", "19:32");
    h.selects = [[importEvent(E1, [i, o])], [corrected(i, E1, "09:45"), rowOf(o, E1)]];
    const res = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(res.ok && res.undo).toMatchObject({ removed: 0, keptModified: 1, keptDayTouched: 1, daysSkipped: 1 });
    expect(h.deletedIds).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("the existing behaviour is unchanged for a batch nobody has touched", async () => {
    const i = invOf(uid(), D1, "in", "10:10"), o = invOf(uid(), D1, "out", "19:32");
    h.selects = [[importEvent(E1, [i, o])], [rowOf(i, E1), rowOf(o, E1)]];
    const res = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(res.ok && res.undo).toMatchObject({ removed: 2, keptModified: 0, keptDayTouched: 0, daysSkipped: 0, missing: 0 });
  });
});
