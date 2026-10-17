import { beforeEach, describe, expect, it, vi } from "vitest";

// Server-action behaviour with the database and auth mocked: nothing here
// touches a real database or real attendance data.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  failFor: new Set<string>(),
  swallow: "none" as "none" | "first" | "all",
  committedPunches: [] as Record<string, unknown>[],
  committedEvents: [] as Record<string, unknown>[],
  deleteReturn: [] as { id: string }[],
  deleteCalls: 0,
  transactions: 0,
  admin: true,
  seq: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current", () => ({
  requireAdmin: async () => {
    if (!h.admin) throw new Error("FORBIDDEN");
    return { id: "99999999-9999-4999-8999-999999999999", isAdmin: true };
  },
}));

function selectChain(): unknown {
  const chain: Record<string, unknown> = {};
  for (const k of ["from", "where", "orderBy", "limit", "for"]) chain[k] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(h.selects.shift() ?? []).then(res);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      h.transactions++;
      const punches: Record<string, unknown>[] = [];
      const events: Record<string, unknown>[] = [];
      const tx = {
        select: () => selectChain(),
        delete: () => ({
          where: () => ({
            returning: async () => {
              h.deleteCalls++;
              return h.deleteReturn;
            },
          }),
        }),
        insert: (table: Record<string, unknown>) => ({
          values: (vals: Record<string, unknown> | Record<string, unknown>[]) => {
            const arr = Array.isArray(vals) ? vals : [vals];
            if ("eventType" in table) {
              events.push(...arr);
              return Promise.resolve();
            }
            return {
              onConflictDoNothing: () => ({
                returning: async () => {
                  const first = arr[0] as { employeeId: string };
                  if (h.failFor.has(first.employeeId)) throw new Error("db exploded");
                  const kept = h.swallow === "all" ? [] : h.swallow === "first" ? arr.slice(1) : arr;
                  punches.push(...kept);
                  return kept.map((k) => ({
                    id: `00000000-0000-4000-8000-${String(++h.seq).padStart(12, "0")}`,
                    logDate: k.logDate,
                    kind: k.kind,
                    loggedAt: k.loggedAt,
                  }));
                },
              }),
            };
          },
        }),
      };
      await fn(tx);
      h.committedPunches.push(...punches);
      h.committedEvents.push(...events);
    },
  },
}));

import {
  inspectImportBatch,
  listImportBatches,
  previewAttendanceImport,
  runAttendanceImport,
  undoImportBatch,
} from "@/app/(app)/hr/attendance-import/actions";

const ME = "99999999-9999-4999-8999-999999999999";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const BATCH = "33333333-3333-4333-8333-333333333333";
const P1 = "44444444-4444-4444-8444-444444444441";
const P2 = "44444444-4444-4444-8444-444444444442";

const day = (date: string, inTime: string | null, outTime: string | null) => ({
  rowNo: 1,
  date,
  inTime,
  outTime,
  status: "Present",
  problems: [] as string[],
});
const src = (code: string, days: ReturnType<typeof day>[], noPunchDays = 0) => ({
  key: code,
  code,
  name: `Test ${code}`,
  department: null,
  days,
  noPunchDays,
});
const PERIOD = { from: "2026-04-01", to: "2026-04-30" };
const ACK = { mappings: true, period: true } as const;

function payload(mapping: Record<string, string>, extra: Record<string, unknown> = {}, employees = [src("1", [day("2026-04-01", "10:10", "19:32")]), src("2", [day("2026-04-01", "09:00", "17:00")])]) {
  return { fileName: "test.xlsx", employees, mapping, declaredPeriod: null, confirmedPeriod: PERIOD, ...extra };
}
const run = (mapping: Record<string, string>, extra: Record<string, unknown> = {}, employees?: ReturnType<typeof src>[]) =>
  runAttendanceImport(payload(mapping, { acknowledged: ACK, ...extra }, employees));

const EMPLOYEES_AB = [
  { id: A, timezone: "Asia/Kolkata", name: "Alpha One", email: "alpha@example.com" },
  { id: B, timezone: "Asia/Kolkata", name: "Beta Two", email: "beta@example.com" },
];

beforeEach(() => {
  h.selects = [];
  h.failFor.clear();
  h.swallow = "none";
  h.committedPunches = [];
  h.committedEvents = [];
  h.deleteReturn = [];
  h.deleteCalls = 0;
  h.transactions = 0;
  h.admin = true;
  h.seq = 0;
});

describe("authorization and input", () => {
  it("every action is admin-only on the server, and a non-admin gets no writes", async () => {
    h.admin = false;
    await expect(previewAttendanceImport(payload({ "1": A, "2": B }))).rejects.toThrow("FORBIDDEN");
    await expect(run({ "1": A, "2": B })).rejects.toThrow("FORBIDDEN");
    await expect(listImportBatches()).rejects.toThrow("FORBIDDEN");
    await expect(inspectImportBatch(BATCH)).rejects.toThrow("FORBIDDEN");
    await expect(undoImportBatch({ batchId: BATCH, confirm: true })).rejects.toThrow("FORBIDDEN");
    expect(h.transactions).toBe(0);
  });

  it("rejects malformed data from the client", async () => {
    const bad = payload({ "1": A }, { acknowledged: ACK }, [src("1", [{ ...day("2026-04-01", "10:10", null), inTime: "10.10" }])]);
    expect((await runAttendanceImport(bad)).ok).toBe(false);
    expect(h.transactions).toBe(0);
  });

  it("will not import without both confirmations and a confirmed period", async () => {
    h.selects = [EMPLOYEES_AB, []];
    expect((await runAttendanceImport(payload({ "1": A, "2": B }))).ok).toBe(false);
    expect((await runAttendanceImport(payload({ "1": A, "2": B }, { acknowledged: { mappings: true, period: false } }))).ok).toBe(false);
    expect((await runAttendanceImport(payload({ "1": A, "2": B }, { acknowledged: ACK, confirmedPeriod: null }))).ok).toBe(false);
    expect(h.transactions).toBe(0);
  });
});

describe("preview", () => {
  it("writes nothing, shows verified identities with first / last dates, and reports blockers", async () => {
    h.selects = [[EMPLOYEES_AB[0]], []];
    const res = await previewAttendanceImport(payload({ "1": A }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.preview.blockers[0]).toMatch(/has not been mapped/);
    expect(res.preview.mapped).toEqual([
      { sourceKey: "1", employeeId: A, name: "Alpha One", email: "alpha@example.com", firstDate: "2026-04-01", lastDate: "2026-04-01", ready: 2, duplicate: 0, mismatch: 0 },
    ]);
    expect(res.preview.punchDates).toMatchObject({ first: "2026-04-01", distinct: 1, label: "April 2026" });
    expect(h.transactions).toBe(0);
  });

  it("warns when the file name month differs from the punch dates", async () => {
    h.selects = [[EMPLOYEES_AB[0]], []];
    const res = await previewAttendanceImport(payload({ "1": A, "2": "skip" }, { fileName: "Report Aug26.xlsx" }));
    expect(res.ok && res.preview.periodWarnings[0]).toMatch(/file name says August 2026, but the dates inside the file are April 2026/);
  });
});

describe("import run: batches, audit and counts", () => {
  it("refuses to run while anything is unmapped", async () => {
    h.selects = [[EMPLOYEES_AB[0]], []];
    expect(await run({ "1": A })).toMatchObject({ ok: false });
    expect(h.transactions).toBe(0);
  });

  it("tags punches with a batch id and records the exact inventory in the audit row", async () => {
    h.selects = [EMPLOYEES_AB, []];
    const res = await run({ "1": A, "2": B });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { batchId } = res.result;
    expect(batchId).toMatch(/^[0-9a-f-]{36}$/);
    const first = h.committedPunches.find((p) => p.employeeId === A && p.kind === "in")!;
    expect(first).toMatchObject({
      logDate: "2026-04-01",
      source: "admin",
      reason: "import",
      verifyMethod: "none",
      recordedById: ME,
      note: `Biometric import · ${batchId}`,
    });
    expect((first.loggedAt as Date).toISOString()).toBe("2026-04-01T04:40:00.000Z");
    expect(h.committedEvents).toHaveLength(2);
    const ev = h.committedEvents[0] as { eventType: string; toValue: { batchId: string; punches: { id: string; kind: string; at: string }[]; inserted: number } };
    expect(ev.eventType).toBe("attendance_import");
    expect(ev.toValue.batchId).toBe(batchId);
    expect(ev.toValue.inserted).toBe(2);
    expect(ev.toValue.punches.map((p) => p.kind)).toEqual(["in", "out"]);
    expect(ev.toValue.punches[0]!.at).toBe("2026-04-01T04:40:00.000Z");
  });

  it("reconciles: imported + skipped + failed = planned, in total and per employee", async () => {
    h.selects = [EMPLOYEES_AB, []];
    h.failFor.add(B);
    const res = await run({ "1": A, "2": B });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.result;
    expect(r).toMatchObject({ planned: 4, inserted: 2, skippedExisting: 0, failed: 2 });
    expect(r.inserted + r.skippedExisting + r.failed).toBe(r.planned);
    for (const e of r.perEmployee) expect(e.inserted + e.skippedExisting + e.failed).toBe(e.planned);
    const bad = r.perEmployee.find((e) => e.sourceKey === "2")!;
    expect(bad.error).toMatch(/Nothing was saved/);
    expect(JSON.stringify(res)).not.toMatch(/db exploded/);
    expect(h.committedPunches.every((p) => p.employeeId === A)).toBe(true);
    expect(h.committedEvents).toHaveLength(1); // no audit for the person whose save failed
  });

  it("keeps stored punches (same or different time), lists a fully skipped person, and writes no audit row for them", async () => {
    h.selects = [
      EMPLOYEES_AB,
      [
        { employeeId: A, logDate: "2026-04-01", kind: "in", loggedAt: new Date("2026-04-01T04:40:00.000Z") }, // same
        { employeeId: A, logDate: "2026-04-01", kind: "out", loggedAt: new Date("2026-04-01T14:00:00.000Z") }, // 19:30 vs 19:32 → differs
        { employeeId: B, logDate: "2026-04-01", kind: "in", loggedAt: new Date("2026-04-01T03:30:00.000Z") },
        { employeeId: B, logDate: "2026-04-01", kind: "out", loggedAt: new Date("2026-04-01T11:30:00.000Z") },
      ],
    ];
    const res = await run({ "1": A, "2": B });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toMatchObject({ planned: 4, inserted: 0, skippedExisting: 4, failed: 0 });
    expect(res.result.perEmployee.map((e) => [e.sourceKey, e.planned, e.skippedExisting])).toEqual([["1", 2, 2], ["2", 2, 2]]);
    expect(h.transactions).toBe(0);
    expect(h.committedPunches).toEqual([]);
    expect(h.committedEvents).toEqual([]);
  });

  it("counts a punch swallowed by a concurrent insert as skipped, and writes no audit row when nothing was inserted", async () => {
    h.selects = [[EMPLOYEES_AB[0]], []];
    h.swallow = "all";
    const res = await run({ "1": A, "2": "skip" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toMatchObject({ planned: 2, inserted: 0, skippedExisting: 2, failed: 0 });
    expect(h.committedEvents).toEqual([]);
  });

  it("counts only the swallowed punch as skipped on a partial race", async () => {
    h.selects = [[EMPLOYEES_AB[0]], []];
    h.swallow = "first";
    const res = await run({ "1": A, "2": "skip" });
    expect(res.ok && res.result).toMatchObject({ inserted: 1, skippedExisting: 1 });
    const ev = h.committedEvents[0] as { toValue: { inserted: number; punches: unknown[] } };
    expect(ev.toValue.inserted).toBe(1);
    expect(ev.toValue.punches).toHaveLength(1);
  });

  it("rejects a punch that is outside the confirmed period instead of writing it", async () => {
    h.selects = [[EMPLOYEES_AB[0]], []];
    const res = await run({ "1": A }, { confirmedPeriod: { from: "2026-05-01", to: "2026-05-31" } }, [src("1", [day("2026-04-01", "10:10", "19:32")])]);
    expect(res.ok && res.result).toMatchObject({ planned: 0, inserted: 0, rejectedRows: 1 });
    expect(h.committedPunches).toEqual([]);
  });
});

describe("batch inventory and undo", () => {
  const importEvent = (employeeId: string, punches: { id: string; date: string; kind: "in" | "out"; at: string }[]) => ({
    employeeId,
    actorId: ME,
    eventType: "attendance_import",
    createdAt: new Date("2026-10-17T08:00:00.000Z"),
    toValue: { batchId: BATCH, file: "apr.xlsx", inserted: punches.length, from: "2026-04-01", to: "2026-04-01", punches },
  });
  const inv = [
    { id: P1, date: "2026-04-01", kind: "in" as const, at: "2026-04-01T04:40:00.000Z" },
    { id: P2, date: "2026-04-01", kind: "out" as const, at: "2026-04-01T14:02:00.000Z" },
  ];
  const stored = (id: string, kind: "in" | "out", at: string, over: Record<string, unknown> = {}) => ({
    id,
    employeeId: A,
    logDate: "2026-04-01",
    kind,
    loggedAt: new Date(at),
    note: `Biometric import · ${BATCH}`,
    source: "admin",
    reason: "import",
    recordedById: ME,
    ...over,
  });

  it("lists batches with people, punch and undone counts", async () => {
    h.selects = [
      [
        importEvent(A, inv),
        { employeeId: A, actorId: ME, eventType: "attendance_import_undo", createdAt: new Date("2026-10-17T09:00:00.000Z"), toValue: { batchId: BATCH, removedIds: [P1] } },
      ],
      [{ id: ME, name: "Admin User", email: "admin@example.com" }],
    ];
    const res = await listImportBatches();
    expect(res.ok && res.batches).toEqual([
      { batchId: BATCH, createdAt: "2026-10-17T08:00:00.000Z", actorName: "Admin User", file: "apr.xlsx", people: 1, punches: 2, removed: 1, from: "2026-04-01", to: "2026-04-01" },
    ]);
  });

  it("inspects a batch read-only: unchanged vs edited punches", async () => {
    h.selects = [
      [importEvent(A, inv)],
      [stored(P1, "in", "2026-04-01T04:40:00.000Z"), stored(P2, "out", "2026-04-01T14:30:00.000Z")], // out was edited
      [stored(P1, "in", "2026-04-01T04:40:00.000Z"), stored(P2, "out", "2026-04-01T14:30:00.000Z")], // every punch stored for those days
      [
        { id: ME, name: "Admin User", email: "admin@example.com" },
        { id: A, name: "Alpha One", email: "alpha@example.com" },
      ],
    ];
    const res = await inspectImportBatch(BATCH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The unchanged IN is not removable: its day was edited, so the whole day is kept.
    expect(res.inspection.totals).toEqual({ recorded: 2, intact: 0, modified: 1, missing: 0, removed: 0, keptDayTouched: 1 });
    expect(res.inspection.people[0]!.modifiedDetails).toEqual([{ date: "2026-04-01", kind: "out", why: ["time was edited"] }]);
    expect(res.inspection.people[0]!.touchedDays).toEqual([{ date: "2026-04-01", why: ["a punch from this import was edited or re-recorded"] }]);
    expect(h.transactions).toBe(0);
  });

  it("undo keeps the WHOLE day when one punch of it was edited: the unchanged IN stays too", async () => {
    h.selects = [
      [importEvent(A, inv)], // loadBatch
      [stored(P1, "in", "2026-04-01T04:40:00.000Z"), stored(P2, "out", "2026-04-01T14:30:00.000Z")], // locked rows in the tx
    ];
    const res = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(res.ok && res.undo).toMatchObject({ removed: 0, keptModified: 1, keptDayTouched: 1, daysSkipped: 1, missing: 0, failedPeople: 0 });
    expect(h.deleteCalls).toBe(0);
    expect(h.committedEvents).toEqual([]);
  });

  it("undo still removes an unchanged punch on a day nobody touched, while skipping the edited day", async () => {
    const twoDays = [
      { id: P1, date: "2026-04-01", kind: "in" as const, at: "2026-04-01T04:40:00.000Z" }, // untouched day
      { id: P2, date: "2026-04-02", kind: "out" as const, at: "2026-04-02T14:02:00.000Z" }, // edited day
    ];
    h.selects = [
      [importEvent(A, twoDays)],
      [stored(P1, "in", "2026-04-01T04:40:00.000Z"), { ...stored(P2, "out", "2026-04-02T14:30:00.000Z"), logDate: "2026-04-02" }],
    ];
    h.deleteReturn = [{ id: P1 }];
    const res = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(res.ok && res.undo).toMatchObject({ removed: 1, keptModified: 1, keptDayTouched: 0, daysSkipped: 1 });
    const ev = h.committedEvents[0] as { toValue: { removedIds: string[]; keptModified: number; daysSkipped: number } };
    expect(ev.toValue).toMatchObject({ removedIds: [P1], keptModified: 1, daysSkipped: 1 });
  });

  it("undo deletes nothing and writes no audit row when every punch was changed or is gone", async () => {
    h.selects = [
      [importEvent(A, inv)],
      [stored(P1, "in", "2026-04-01T04:40:00.000Z", { reason: "correction" })], // P2 missing
    ];
    const res = await undoImportBatch({ batchId: BATCH, confirm: true });
    expect(res.ok && res.undo).toMatchObject({ removed: 0, keptModified: 1, missing: 1 });
    expect(h.deleteCalls).toBe(0);
    expect(h.committedEvents).toEqual([]);
  });

  it("undo needs an explicit confirmation and a known batch", async () => {
    expect((await undoImportBatch({ batchId: BATCH, confirm: false })).ok).toBe(false);
    h.selects = [[]];
    expect(await undoImportBatch({ batchId: BATCH, confirm: true })).toMatchObject({ ok: false });
    expect(h.transactions).toBe(0);
  });
});
