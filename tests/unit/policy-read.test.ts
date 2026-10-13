import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolvePolicy, type PolicyChange } from "@/lib/attendance/policy";
import { PolicyReadError, readNullLeaveKind, resolvePolicyStrict } from "@/lib/attendance/policy-read";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const ASOF = "2026-10-01";
const change = (key: string, value: PolicyChange["value"], effectiveFrom = "2026-10-01"): PolicyChange => ({
  key,
  value,
  effectiveFrom,
  createdAt: new Date("2026-09-20"),
});

describe("reading the approved-leave setting", () => {
  it("returns the configured value when the policy reads fine, in either mode", async () => {
    const unpaid = resolvePolicy([change("approved_leave_payment", "unpaid")], ASOF);
    expect(await readNullLeaveKind(async () => unpaid, ASOF, { strict: true })).toBe("unpaid");
    expect(await readNullLeaveKind(async () => unpaid, ASOF, { strict: false })).toBe("unpaid");
  });

  it("display mode falls back to the initial setting, and logs it, when the read fails", async () => {
    const log = vi.fn();
    const pay = await readNullLeaveKind(async () => Promise.reject(new Error("db down")), ASOF, { strict: false, log });
    expect(pay).toBe("paid"); // the initial policy value
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("strict mode (salary) throws a clear error when the read fails — no fallback", async () => {
    const log = vi.fn();
    const attempt = readNullLeaveKind(async () => Promise.reject(new Error("db down")), ASOF, { strict: true, log });
    await expect(attempt).rejects.toBeInstanceOf(PolicyReadError);
    await expect(attempt).rejects.toThrow(/salary was not generated/i);
    expect(log).not.toHaveBeenCalled(); // never "handled" quietly
  });

  it("strict mode also refuses a policy value that is not paid or unpaid", async () => {
    const bad = { ...resolvePolicy([], ASOF), approved_leave_payment: "half" } as never;
    await expect(readNullLeaveKind(async () => bad, ASOF, { strict: true })).rejects.toBeInstanceOf(PolicyReadError);
  });

  it("strict resolution rejects a stored value that fails validation, but only if it applies yet", () => {
    const corrupt = change("approved_leave_payment", "sometimes", "2026-10-01");
    expect(() => resolvePolicyStrict([corrupt], ASOF)).toThrow(PolicyReadError);
    // Not yet effective for September, so September is unaffected.
    expect(resolvePolicyStrict([corrupt], "2026-09-01").approved_leave_payment).toBe("paid");
  });

  it("strict resolution keeps the effective-date rules and configured values", () => {
    const changes = [change("approved_leave_payment", "unpaid", "2026-11-01")];
    expect(resolvePolicyStrict(changes, "2026-10-01").approved_leave_payment).toBe("paid");
    expect(resolvePolicyStrict(changes, "2026-11-01").approved_leave_payment).toBe("unpaid");
  });
});

describe("salary generation uses the strict path (source checks)", () => {
  it("assembleMonthInputs asks the dashboard for strictPolicy", () => {
    expect(read("lib/salary/generate.ts")).toContain("{ strictPolicy: true }");
  });
  it("the dashboard routes strictPolicy to the strict reader; the single-employee display path stays lenient", () => {
    const src = read("lib/queries/attendance-status.ts");
    expect(src).toContain("nullLeaveKindForMonth(year, month, filters?.strictPolicy === true)");
    expect(src).toContain("getPolicyAsOfStrict(asOf)");
    expect(src.split("nullLeaveKindForMonth(year, month),")).toHaveLength(2); // the display grid, lenient
  });
  it("generateSalary reports a policy-read failure as such and writes nothing first", () => {
    const src = read("app/(app)/salary/actions.ts");
    expect(src).toContain("err instanceof PolicyReadError");
    // Inputs are assembled before the first write.
    expect(src.indexOf("await assembleMonthInputs(month)")).toBeLessThan(src.indexOf(".insert(salaryRuns)"));
  });
});
