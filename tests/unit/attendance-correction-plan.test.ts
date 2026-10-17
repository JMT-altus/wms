import { describe, expect, it } from "vitest";
import {
  CORRECTION_REASONS,
  composeNote,
  explanationError,
  planCorrection,
  reasonLabel,
  type ExistingPunch,
  type PlanInput,
} from "@/lib/attendance/correction/plan";

const punch = (time: string, over: Partial<ExistingPunch> = {}): ExistingPunch => ({
  id: "p-" + time,
  time,
  loggedAt: "2026-04-01T04:40:00.000Z",
  note: null,
  source: "self",
  reason: null,
  ...over,
});

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  date: "2026-04-01",
  inTime: "10:00",
  outTime: "18:00",
  reason: "power_failure",
  explanation: "Power cut from 9 to 11:30, machine was off.",
  today: "2026-10-17",
  joinDay: "2026-01-05",
  existing: { in: null, out: null },
  ...over,
});

describe("reasons and explanation", () => {
  it("offers exactly the four reasons, as stored codes with labels", () => {
    expect(CORRECTION_REASONS.map((r) => [r.code, r.label])).toEqual([
      ["power_failure", "Power failure"],
      ["biometric_unavailable", "Biometric machine unavailable"],
      ["missed_punch", "Missed punch"],
      ["other", "Other"],
    ]);
    expect(reasonLabel("biometric_unavailable")).toBe("Biometric machine unavailable");
  });

  it("requires a meaningful explanation for every reason, and a fuller one for Other", () => {
    expect(explanationError("power_failure", "")).toMatch(/required/);
    expect(explanationError("power_failure", "   ")).toMatch(/required/);
    expect(explanationError("power_failure", "power")).toMatch(/meaningful/);
    expect(explanationError("power_failure", "Power cut in the morning")).toBeNull();
    expect(explanationError("other", "Machine broke down")).toMatch(/Other.*fuller explanation/);
    expect(explanationError("other", "Machine broke and was replaced the same day")).toBeNull();
    expect(explanationError("missed_punch", "x".repeat(501))).toMatch(/under 500/);
  });

  it("never discards an existing note: the explanation is appended", () => {
    expect(composeNote(null, "  Power cut  ")).toBe("Power cut");
    expect(composeNote("", "Power cut")).toBe("Power cut");
    expect(composeNote("Forgot to punch out", "Power cut")).toBe("Forgot to punch out | HR correction: Power cut");
  });
});

describe("planCorrection", () => {
  it("adds both punches for a day with none", () => {
    const r = planCorrection(base());
    expect(r).toMatchObject({ ok: true, finalIn: "10:00", finalOut: "18:00" });
    expect(r.ok && r.changes.map((c) => [c.kind, c.action, c.from, c.to])).toEqual([
      ["in", "add", null, "10:00"],
      ["out", "add", null, "18:00"],
    ]);
  });

  it("adds only the missing side and keeps the other as stored", () => {
    const r = planCorrection(base({ inTime: "", outTime: "18:30", existing: { in: punch("10:00"), out: null } }));
    expect(r).toMatchObject({ ok: true, finalIn: "10:00", finalOut: "18:30" });
    expect(r.ok && r.changes).toHaveLength(1);
    expect(r.ok && r.changes[0]).toMatchObject({ kind: "out", action: "add" });
  });

  it("changes an existing time and records the previous one", () => {
    const r = planCorrection(base({ inTime: "09:45", outTime: null, existing: { in: punch("10:20", { note: "late bus" }), out: punch("18:00") } }));
    expect(r.ok && r.changes[0]).toMatchObject({ kind: "in", action: "change", from: "10:20", to: "09:45", existingNote: "late bus" });
    expect(r.ok && r.finalOut).toBe("18:00");
  });

  it("ignores a side that already has the entered time, and refuses when nothing would change", () => {
    const r = planCorrection(base({ inTime: "10:00", outTime: "18:30", existing: { in: punch("10:00"), out: punch("18:00") } }));
    expect(r.ok && r.changes.map((c) => c.kind)).toEqual(["out"]);
    const none = planCorrection(base({ inTime: "10:00", outTime: "18:00", existing: { in: punch("10:00"), out: punch("18:00") } }));
    expect(none).toEqual({ ok: false, error: expect.stringMatching(/Nothing to change/) });
  });

  it("needs at least one time, and never invents one", () => {
    expect(planCorrection(base({ inTime: "", outTime: null }))).toEqual({ ok: false, error: expect.stringMatching(/Enter an IN time/) });
  });

  it("rejects bad time formats", () => {
    expect(planCorrection(base({ inTime: "9:30" }))).toMatchObject({ ok: false, error: expect.stringMatching(/IN time must be HH:mm/) });
    expect(planCorrection(base({ outTime: "25:00" }))).toMatchObject({ ok: false, error: expect.stringMatching(/OUT time must be HH:mm/) });
  });

  it("rejects OUT earlier than IN, including against a stored time, and has no overnight support", () => {
    expect(planCorrection(base({ inTime: "18:00", outTime: "06:00" }))).toMatchObject({ ok: false, error: expect.stringMatching(/can't be earlier than IN/) });
    const vsStored = planCorrection(base({ inTime: "", outTime: "09:00", existing: { in: punch("10:00"), out: null } }));
    expect(vsStored).toMatchObject({ ok: false, error: expect.stringMatching(/OUT \(09:00\) can't be earlier than IN \(10:00\)/) });
    expect(planCorrection(base({ inTime: "10:00", outTime: "10:00" })).ok).toBe(true);
  });

  it("rejects future dates, dates before joining, and impossible dates", () => {
    expect(planCorrection(base({ date: "2026-10-18" }))).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
    expect(planCorrection(base({ date: "2026-10-17" })).ok).toBe(true); // today is allowed
    expect(planCorrection(base({ date: "2025-12-31" }))).toMatchObject({ ok: false, error: expect.stringMatching(/joined on 2026-01-05/) });
    expect(planCorrection(base({ date: "2026-01-05" })).ok).toBe(true); // the join day itself is allowed
    expect(planCorrection(base({ date: "2026-02-31" }))).toMatchObject({ ok: false, error: expect.stringMatching(/not valid/) });
  });

  it("needs a reason and an explanation before anything else", () => {
    expect(planCorrection(base({ reason: "" }))).toEqual({ ok: false, error: "Choose a reason." });
    expect(planCorrection(base({ reason: "holiday" }))).toEqual({ ok: false, error: "Choose a reason." });
    expect(planCorrection(base({ explanation: "" }))).toMatchObject({ ok: false, error: expect.stringMatching(/required/) });
    expect(planCorrection(base({ reason: "other", explanation: "short note" }))).toMatchObject({ ok: false });
  });
});
