import { describe, it, expect } from "vitest";
import { fileNameMonth, periodWarnings, summarizeDates } from "@/lib/attendance/import/period";
import { batchNote, classifyBatchPunch, parseImportEvent, type InventoryPunch, type StoredPunch } from "@/lib/attendance/import/batch";
import { buildPayload, payloadTooLarge, MAX_PAYLOAD_BYTES } from "@/lib/attendance/import/payload";
import type { ParsedReport } from "@/lib/attendance/import/parse-report";

describe("period summary", () => {
  it("reports earliest, latest, distinct dates and the month, whatever the file is called", () => {
    const s = summarizeDates(["2026-04-30", "2026-04-01", "2026-04-01", null, "bad"]);
    expect(s).toMatchObject({ first: "2026-04-01", last: "2026-04-30", distinct: 2, label: "April 2026" });
  });

  it("labels a multi-month span", () => {
    expect(summarizeDates(["2026-03-31", "2026-04-02"]).label).toBe("March 2026 – April 2026 (2 months)");
    expect(summarizeDates([]).label).toBe("no dates");
  });
});

describe("file name month", () => {
  it("reads the month (and year) from file names", () => {
    expect(fileNameMonth("Daily Attendance Report Aug26.xlsx.xlsx")).toEqual({ month: 8, year: 2026 });
    expect(fileNameMonth("Daily Attendance Report JUn26.xlsx")).toEqual({ month: 6, year: 2026 });
    expect(fileNameMonth("attendance_March_2026.csv")).toEqual({ month: 3, year: 2026 });
  });
  it("does not read months out of ordinary words", () => {
    expect(fileNameMonth("Daily Attendance Report.xlsx.xlsx")).toBeNull();
    expect(fileNameMonth("Summary Mark Decimal.xlsx")).toBeNull();
  });
});

describe("period warnings", () => {
  const april = summarizeDates(["2026-04-01", "2026-04-30"]);

  it("warns when the file name month differs from the dates inside", () => {
    const w = periodWarnings({ fileName: "Report Aug26.xlsx", dates: april, declared: null });
    expect(w[0]).toMatch(/file name says August 2026, but the dates inside the file are April 2026/);
  });
  it("is quiet when name and data agree", () => {
    expect(periodWarnings({ fileName: "Report Apr26.xlsx", dates: april, declared: { from: "2026-04-01", to: "2026-04-30" } })).toEqual([]);
  });
  it("warns about rows outside the declared period and about multi-month data", () => {
    const w = periodWarnings({
      fileName: null,
      dates: summarizeDates(["2026-03-30", "2026-04-02"]),
      declared: { from: "2026-04-01", to: "2026-04-30" },
    });
    expect(w.join(" ")).toMatch(/span 2 months/);
    expect(w.join(" ")).toMatch(/outside the file's own reporting period/);
  });
  it("covers CSV / flat tables too (no declared period, dates still summarised)", () => {
    expect(periodWarnings({ fileName: "export.csv", dates: april, declared: null })).toEqual([]);
  });
});

describe("batch identification", () => {
  const BATCH = "33333333-3333-4333-8333-333333333333";
  const ACTOR = "99999999-9999-4999-8999-999999999999";
  const EMP = "11111111-1111-4111-8111-111111111111";
  const inv: InventoryPunch = { id: "44444444-4444-4444-8444-444444444444", date: "2026-04-01", kind: "in", at: "2026-04-01T04:40:00.000Z" };
  const stored = (over: Partial<StoredPunch> = {}): StoredPunch => ({
    id: inv.id,
    employeeId: EMP,
    logDate: "2026-04-01",
    kind: "in",
    loggedAt: new Date(inv.at),
    note: batchNote(BATCH),
    source: "admin",
    reason: "import",
    recordedById: ACTOR,
    ...over,
  });
  const ctx = { batchId: BATCH, actorId: ACTOR };

  it("calls a punch unchanged only while every identifying field still holds", () => {
    expect(classifyBatchPunch(inv, EMP, stored(), ctx)).toEqual({ state: "intact" });
  });

  it("treats an edited time, a re-recorded reason, a changed owner or a different batch as modified", () => {
    const why = (over: Partial<StoredPunch>) => {
      const r = classifyBatchPunch(inv, EMP, stored(over), ctx);
      return r.state === "modified" ? r.why : r.state;
    };
    expect(why({ loggedAt: new Date("2026-04-01T04:45:00.000Z") })).toContain("time was edited");
    expect(why({ reason: "correction" })).toContain("reason changed");
    expect(why({ recordedById: "55555555-5555-4555-8555-555555555555" })).toContain("recorded by someone else");
    expect(why({ note: batchNote("66666666-6666-4666-8666-666666666666") })).toContain("note changed");
    expect(why({ employeeId: "22222222-2222-4222-8222-222222222222" })).toContain("different employee");
  });

  it("reports a punch that no longer exists as missing", () => {
    expect(classifyBatchPunch(inv, EMP, undefined, ctx)).toEqual({ state: "missing" });
  });

  it("parses the audit inventory and ignores malformed entries", () => {
    const v = parseImportEvent({ batchId: BATCH, file: "a.xlsx", inserted: 1, punches: [inv, { id: "x", date: "d", kind: "in", at: "no" }] });
    expect(v?.punches).toEqual([inv]);
    expect(parseImportEvent({ batchId: "nope", punches: [] })).toBeNull();
  });
});

describe("payload size", () => {
  const report = (days: number): ParsedReport => ({
    sheet: "S",
    layout: "block-report",
    period: { from: "2026-04-01", to: "2026-04-30" },
    warnings: [],
    employees: [
      {
        key: "1",
        code: "1",
        name: "Test",
        department: null,
        days: Array.from({ length: days }, (_, i) => ({
          rowNo: i + 1,
          date: `2026-04-${String((i % 28) + 1).padStart(2, "0")}`,
          dateRaw: "raw",
          inTime: i % 2 ? "10:00" : null,
          outTime: i % 2 ? "18:00" : null,
          shift: "GS",
          duration: "8:00",
          status: "Present",
          problems: [],
        })),
      },
    ],
  });

  it("sends only days with punch times or problems and counts the rest", () => {
    const p = buildPayload(report(10), { "1": "skip" }, { confirmedPeriod: null });
    expect(p.employees[0]!.days).toHaveLength(5);
    expect(p.employees[0]!.noPunchDays).toBe(5);
    expect(p.employees[0]!.days[0]).not.toHaveProperty("shift");
    expect(p.declaredPeriod).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("accepts a normal month and refuses an oversized file with a clear message", () => {
    expect(payloadTooLarge(buildPayload(report(31), {}, { confirmedPeriod: null }))).toBeNull();
    const msg = payloadTooLarge(buildPayload(report(20_000), {}, { confirmedPeriod: null }));
    expect(msg).toMatch(/too large to import in one go/);
    expect(msg).toMatch(/Split it by month/);
    expect(MAX_PAYLOAD_BYTES).toBeLessThan(1024 * 1024);
  });
});
