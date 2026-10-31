import { describe, expect, it } from "vitest";

// The pure Collection scope rule (lib/collections/scope.ts): which Sales Coordinator labels are inside a scope, and what
// an empty screen says. The session-backed resolver is covered with real rows in collection-tracker-scope.db.test.ts.
import { inScope, scopeMessage, scopeNote, type CollectionScope } from "@/lib/collections/scope";

describe("inScope", () => {
  it("'all' admits every company, assigned or not", () => {
    for (const label of ["Gauri", "MANGESH", null, undefined, ""]) expect(inScope({ kind: "all" }, label)).toBe(true);
  });
  it("a coordinator scope admits exactly that label (trimmed, case-sensitive), never unassigned or another label", () => {
    const gauri: CollectionScope = { kind: "coordinator", label: "Gauri" };
    expect(inScope(gauri, "Gauri")).toBe(true);
    expect(inScope(gauri, " Gauri ")).toBe(true);
    expect(inScope(gauri, "gauri")).toBe(false); // a different stored label is a different coordinator: fail closed
    expect(inScope(gauri, "Bhavisha")).toBe(false);
    expect(inScope(gauri, null)).toBe(false);
    expect(inScope(gauri, "")).toBe(false);
  });
  it("'none' admits nothing, whatever the reason", () => {
    for (const reason of ["signed-out", "unconfigured", "not-salesperson", "not-installed"] as const) {
      expect(inScope({ kind: "none", reason }, "Gauri")).toBe(false);
      expect(inScope({ kind: "none", reason }, null)).toBe(false);
    }
  });
});

describe("what the screens say", () => {
  it("names the reason a login sees nothing; says whose companies a coordinator sees; nothing for a super-admin", () => {
    expect(scopeMessage({ kind: "none", reason: "unconfigured" })).toMatch(/isn't linked to a Sales Coordinator yet/);
    expect(scopeMessage({ kind: "none", reason: "not-salesperson" })).toMatch(/marked as not a Sales Coordinator/);
    expect(scopeMessage({ kind: "none", reason: "not-installed" })).toMatch(/migration 0120/);
    expect(scopeMessage({ kind: "none", reason: "signed-out" })).toMatch(/Sign in/);
    expect(scopeMessage({ kind: "coordinator", label: "Gauri" })).toBeNull();
    expect(scopeMessage({ kind: "all" })).toBeNull();
    expect(scopeNote({ kind: "coordinator", label: "Gauri" })).toBe("Showing the companies assigned to you as Sales Coordinator (Gauri).");
    expect(scopeNote({ kind: "all" })).toBeNull();
    expect(scopeNote({ kind: "none", reason: "unconfigured" })).toBeNull();
  });
});
