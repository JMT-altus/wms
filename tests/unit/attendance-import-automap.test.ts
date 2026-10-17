import { describe, expect, it } from "vitest";
import {
  normalizeName,
  resolveSavedMappings,
  usableCode,
  type MappingTarget,
  type SavedMapping,
} from "@/lib/attendance/import/auto-map";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const emp = (id: string, name: string, isActive = true): MappingTarget => ({ id, name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`, isActive });
const saved = (code: string, employeeId: string, nameInFile: string): SavedMapping => ({ code, employeeId, nameInFile, confirmedAt: "2026-10-01T00:00:00.000Z" });
const src = (code: string, name: string, key = code) => ({ key, code, name });

const savedMap = (...rows: SavedMapping[]) => new Map(rows.map((r) => [r.code, r]));
const empMap = (...rows: MappingTarget[]) => new Map(rows.map((r) => [r.id, r]));

describe("automatic matching from saved biometric mappings", () => {
  it("selects a saved match when code, name and an active employee all agree", () => {
    const out = resolveSavedMappings([src("12", "Bhavisha")], savedMap(saved("12", A, "Bhavisha")), empMap(emp(A, "Alpha One")));
    expect(out["12"]).toMatchObject({ status: "matched", employeeId: A, name: "Alpha One", email: "alpha.one@example.test" });
  });

  it("ignores case and spacing in the name, but nothing else", () => {
    expect(normalizeName("  Manoj   2 ")).toBe("manoj 2");
    const out = resolveSavedMappings([src("34", "MANOJ  2")], savedMap(saved("34", A, "Manoj 2")), empMap(emp(A, "Alpha One")));
    expect(out["34"]!.status).toBe("matched");
  });

  it("leaves an unknown code unresolved, with the reason", () => {
    const out = resolveSavedMappings([src("99", "Someone")], savedMap(saved("12", A, "Bhavisha")), empMap(emp(A, "Alpha One")));
    expect(out["99"]).toMatchObject({ status: "unresolved", reason: "unknown_code" });
    expect((out["99"] as { message: string }).message).toMatch(/no saved match/);
  });

  it("never matches on a name alone: an employee with the same name but no saved code is not selected", () => {
    const out = resolveSavedMappings([src("77", "Alpha One")], new Map(), empMap(emp(A, "Alpha One")));
    expect(out["77"]).toMatchObject({ status: "unresolved", reason: "unknown_code" });
  });

  it("does not trust a saved code when the name in the file has changed", () => {
    const out = resolveSavedMappings([src("12", "Someone Else")], savedMap(saved("12", A, "Bhavisha")), empMap(emp(A, "Alpha One")));
    expect(out["12"]).toMatchObject({ status: "unresolved", reason: "name_changed" });
    const u = out["12"] as { message: string; saved: { employeeName: string | null; nameInFile: string } | null };
    expect(u.message).toMatch(/saved for "Bhavisha" but this file says "Someone Else"/);
    expect(u.saved).toMatchObject({ employeeName: "Alpha One", nameInFile: "Bhavisha" });
  });

  it("flags a file that now has no name where one was confirmed", () => {
    const out = resolveSavedMappings([src("12", "")], savedMap(saved("12", A, "Bhavisha")), empMap(emp(A, "Alpha One")));
    expect(out["12"]).toMatchObject({ status: "unresolved", reason: "name_changed" });
  });

  it("leaves an inactive employee unresolved", () => {
    const out = resolveSavedMappings([src("12", "Bhavisha")], savedMap(saved("12", A, "Bhavisha")), empMap(emp(A, "Alpha One", false)));
    expect(out["12"]).toMatchObject({ status: "unresolved", reason: "employee_inactive" });
  });

  it("leaves a deleted employee unresolved", () => {
    const out = resolveSavedMappings([src("12", "Bhavisha")], savedMap(saved("12", A, "Bhavisha")), empMap());
    expect(out["12"]).toMatchObject({ status: "unresolved", reason: "employee_missing" });
  });

  it("does not match a code that appears twice in the file", () => {
    const out = resolveSavedMappings(
      [src("12", "Bhavisha", "12#1"), src("12", "Bhavisha", "12#2")],
      savedMap(saved("12", A, "Bhavisha")),
      empMap(emp(A, "Alpha One")),
    );
    expect(out["12#1"]).toMatchObject({ status: "unresolved", reason: "code_listed_twice" });
    expect(out["12#2"]).toMatchObject({ status: "unresolved", reason: "code_listed_twice" });
  });

  it("treats a missing code (CSV without codes) as unresolved", () => {
    expect(usableCode("—")).toBeNull();
    expect(usableCode("  ")).toBeNull();
    const out = resolveSavedMappings([src("—", "Bhavisha", "name:bhavisha")], savedMap(saved("12", A, "Bhavisha")), empMap(emp(A, "Alpha One")));
    expect(out["name:bhavisha"]).toMatchObject({ status: "unresolved", reason: "no_code" });
  });

  it("resolves each row independently", () => {
    const out = resolveSavedMappings(
      [src("12", "Bhavisha"), src("30", "Salman"), src("31", "Gauri")],
      savedMap(saved("12", A, "Bhavisha"), saved("30", B, "Salman")),
      empMap(emp(A, "Alpha One"), emp(B, "Beta Two", false)),
    );
    expect(out["12"]!.status).toBe("matched");
    expect(out["30"]).toMatchObject({ reason: "employee_inactive" });
    expect(out["31"]).toMatchObject({ reason: "unknown_code" });
  });
});
