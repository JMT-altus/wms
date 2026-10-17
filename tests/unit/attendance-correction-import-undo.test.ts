import { beforeEach, describe, expect, it, vi } from "vitest";

// How an HR correction interacts with bulk-import batch undo. The real save action
// produces the corrected punch values; the real undo action then sees that stored
// state. Database, sign-in and access are mocked: nothing here touches real data.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updateValues: [] as Record<string, unknown>[],
  insertValues: [] as Record<string, unknown>[],
  deleteCalls: 0,
  deleteReturn: [] as { id: string }[],
  undoEvents: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => ({ id: "88888888-8888-4888-8888-888888888888", isAdmin: false, isActive: true }),
  requireAdmin: async () => ({ id: "99999999-9999-4999-8999-999999999999", isAdmin: true }),
}));
vi.mock("@/lib/auth/module-access", () => ({ getModuleAccessFor: async () => ({ hr: { allowed: true } }) }));
vi.mock("@/lib/queries/attendance-status", () => ({ getEmployeeMonthStatus: async () => ({ days: [] }) }));

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
        insert: (table: Record<string, unknown>) => ({
          values: (v: Record<string, unknown>) => {
            if ("eventType" in table) h.undoEvents.push(v);
            else h.insertValues.push(v);
            return Promise.resolve();
          },
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => {
                h.updateValues.push(v);
                return [{ id: "u" }];
              },
            }),
          }),
        }),
        delete: () => ({
          where: () => ({
            returning: async () => {
              h.deleteCalls++;
              return h.deleteReturn;
            },
          }),
        }),
      }),
  },
}));

import { saveCorrection } from "@/app/(app)/hr/attendance-correction/actions";
import { undoImportBatch } from "@/app/(app)/hr/attendance-import/actions";
import { batchNote, classifyBatchPunch, type InventoryPunch } from "@/lib/attendance/import/batch";

const IMPORTER = "99999999-9999-4999-8999-999999999999";
const EMP = "11111111-1111-4111-8111-111111111111";
const BATCH = "33333333-3333-4333-8333-333333333333";
const P_IN = "44444444-4444-4444-8444-444444444441";
const P_OUT = "44444444-4444-4444-8444-444444444442";
const IN_ISO = "2026-04-01T04:40:00.000Z"; // 10:10 IST
const OUT_ISO = "2026-04-01T14:02:00.000Z"; // 19:32 IST

const employee = {
  id: EMP, name: "Alpha One", email: "alpha@example.test", timezone: "Asia/Kolkata", isActive: true,
  joinedAt: new Date("2026-01-05T00:00:00+05:30"), createdAt: new Date("2026-01-01T00:00:00Z"),
};
/** A punch exactly as the bulk import wrote it. */
const imported = (id: string, kind: "in" | "out", iso: string) => ({
  id, kind, loggedAt: new Date(iso), note: batchNote(BATCH), source: "admin", reason: "import",
});
const inv: InventoryPunch[] = [
  { id: P_IN, date: "2026-04-01", kind: "in", at: IN_ISO },
  { id: P_OUT, date: "2026-04-01", kind: "out", at: OUT_ISO },
];
const importEvent = (punches: InventoryPunch[]) => ({
  employeeId: EMP, actorId: IMPORTER, eventType: "attendance_import", createdAt: new Date("2026-10-17T08:00:00Z"),
  toValue: { batchId: BATCH, file: "april.xlsx", inserted: punches.length, from: "2026-04-01", to: "2026-04-01", punches },
});
/** The row the undo would find after the correction's UPDATE was applied. */
const afterCorrection = (before: ReturnType<typeof imported>, set: Record<string, unknown>) => ({
  ...before,
  employeeId: EMP,
  logDate: "2026-04-01",
  recordedById: IMPORTER,
  ...set,
});
const intactRow = (r: ReturnType<typeof imported>) => ({ ...r, employeeId: EMP, logDate: "2026-04-01", recordedById: IMPORTER });

const correct = (over: Record<string, unknown>, rows: ReturnType<typeof imported>[], snapshot: Record<string, string | null>) =>
  saveCorrection({
    employeeId: EMP, date: "2026-04-01", inTime: "", outTime: "", reason: "power_failure",
    explanation: "Power cut from 9 to 11:30, machine was off.", snapshot, confirmed: true, ...over,
  }).then((res) => ({ res, rows }));

beforeEach(() => {
  h.selects = [];
  h.updateValues = [];
  h.insertValues = [];
  h.undoEvents = [];
  h.deleteCalls = 0;
  h.deleteReturn = [];
});

describe("a corrected imported punch is preserved by batch undo", () => {
  it("the correction changes every field undo uses to recognise an unchanged punch", async () => {
    h.selects = [[employee], [imported(P_IN, "in", IN_ISO)]];
    const { res } = await correct({ inTime: "09:45" }, [], { in: IN_ISO, out: null });
    expect(res.ok).toBe(true);
    const set = h.updateValues[0]!;
    const state = classifyBatchPunch(inv[0]!, EMP, afterCorrection(imported(P_IN, "in", IN_ISO), set) as never, { batchId: BATCH, actorId: IMPORTER });
    expect(state.state).toBe("modified");
    // The batch tag is kept inside the note (nothing discarded), but it no longer matches exactly.
    expect(String(set.note)).toContain(batchNote(BATCH));
    expect(String(set.note)).toContain("HR correction: Power cut");
    expect(set.reason).toBe("power_failure");
    if (state.state === "modified") expect(state.why).toEqual(expect.arrayContaining(["time was edited", "reason changed", "note changed", "recorded by someone else"]));
  });

  it("corrected IN, untouched OUT: undo keeps BOTH punches of the day", async () => {
    // 1) HR corrects the imported IN.
    h.selects = [[employee], [imported(P_IN, "in", IN_ISO), imported(P_OUT, "out", OUT_ISO)]];
    const { res } = await correct({ inTime: "09:45" }, [], { in: IN_ISO, out: OUT_ISO });
    expect(res.ok).toBe(true);
    const corrected = afterCorrection(imported(P_IN, "in", IN_ISO), h.updateValues[0]!);

    // 2) An admin later runs the batch undo. The OUT is unchanged since the import, but its day was corrected.
    h.selects = [[importEvent(inv)], [corrected, intactRow(imported(P_OUT, "out", OUT_ISO))]];
    const undo = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(undo.ok && undo.undo).toMatchObject({ removed: 0, keptModified: 1, keptDayTouched: 1, daysSkipped: 1, missing: 0 });
    expect(h.deleteCalls).toBe(0);
    expect(h.undoEvents.filter((e) => e.eventType === "attendance_import_undo")).toEqual([]);
  });

  it("untouched IN, corrected OUT: undo keeps BOTH punches of the day", async () => {
    h.selects = [[employee], [imported(P_IN, "in", IN_ISO), imported(P_OUT, "out", OUT_ISO)]];
    const { res } = await correct({ outTime: "18:30" }, [], { in: IN_ISO, out: OUT_ISO });
    expect(res.ok).toBe(true);
    const corrected = afterCorrection(imported(P_OUT, "out", OUT_ISO), h.updateValues[0]!);

    h.selects = [[importEvent(inv)], [intactRow(imported(P_IN, "in", IN_ISO)), corrected]];
    const undo = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(undo.ok && undo.undo).toMatchObject({ removed: 0, keptModified: 1, keptDayTouched: 1, daysSkipped: 1 });
    expect(h.deleteCalls).toBe(0);
  });

  it("when every imported punch of the day was corrected, undo deletes nothing at all", async () => {
    h.selects = [[employee], [imported(P_IN, "in", IN_ISO), imported(P_OUT, "out", OUT_ISO)]];
    await correct({ inTime: "09:45", outTime: "18:30" }, [], { in: IN_ISO, out: OUT_ISO });
    const [setIn, setOut] = h.updateValues;
    h.selects = [[importEvent(inv)], [afterCorrection(imported(P_IN, "in", IN_ISO), setIn!), afterCorrection(imported(P_OUT, "out", OUT_ISO), setOut!)]];
    const undo = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(undo.ok && undo.undo).toMatchObject({ removed: 0, keptModified: 2 });
    expect(h.deleteCalls).toBe(0);
  });

  it("HR adds an OUT to an imported IN-only day: undo keeps both punches", async () => {
    // The import wrote only the IN. HR adds the OUT.
    h.selects = [[employee], [imported(P_IN, "in", IN_ISO)]];
    const { res } = await correct({ outTime: "18:30" }, [], { in: IN_ISO, out: null });
    expect(res.ok).toBe(true);
    expect(h.insertValues).toHaveLength(1);
    expect(h.insertValues[0]).toMatchObject({ kind: "out", reason: "power_failure" });
    const hrAdded = { id: "55555555-5555-4555-8555-555555555555", employeeId: EMP, logDate: "2026-04-01", kind: "out", loggedAt: new Date("2026-04-01T13:00:00.000Z"), note: "Power cut from 9 to 11:30, machine was off.", source: "admin", reason: "power_failure", recordedById: "88888888-8888-4888-8888-888888888888" };

    // Undo's inventory knows only the IN. The day now also holds a punch this import did not write.
    h.selects = [[importEvent([inv[0]!])], [intactRow(imported(P_IN, "in", IN_ISO)), hrAdded]];
    const undo = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(undo.ok && undo.undo).toMatchObject({ removed: 0, keptModified: 0, keptDayTouched: 1, daysSkipped: 1 });
    expect(h.deleteCalls).toBe(0);
    expect(h.undoEvents.filter((e) => e.eventType === "attendance_import_undo")).toEqual([]);
  });
});
