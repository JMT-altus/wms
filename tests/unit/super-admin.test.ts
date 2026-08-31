import { describe, it, expect } from "vitest";
import { isSuperAdmin, SUPER_ADMIN_EMAILS } from "@/lib/auth/super-admin";

describe("isSuperAdmin", () => {
  it("returns true for the two exact super-admin emails", () => {
    expect(isSuperAdmin("mihir.jmtds@gmail.com")).toBe(true);
    expect(isSuperAdmin("jmt.altus@gmail.com")).toBe(true);
  });

  it("returns true regardless of case", () => {
    expect(isSuperAdmin("MIHIR.JMTDS@GMAIL.COM")).toBe(true);
    expect(isSuperAdmin("JMT.Altus@Gmail.Com")).toBe(true);
  });

  it("returns true with surrounding whitespace", () => {
    expect(isSuperAdmin("  mihir.jmtds@gmail.com  ")).toBe(true);
    expect(isSuperAdmin("\tjmt.altus@gmail.com\n")).toBe(true);
  });

  it("returns false for any other email", () => {
    expect(isSuperAdmin("altus@carbideindia.com")).toBe(false);
    expect(isSuperAdmin("someone@example.com")).toBe(false);
    expect(isSuperAdmin("mihir.jmtds@gmail.co")).toBe(false);
  });

  it("returns false for null / undefined / empty", () => {
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
    expect(isSuperAdmin("")).toBe(false);
  });

  it("exposes exactly the two configured emails", () => {
    expect(SUPER_ADMIN_EMAILS).toHaveLength(2);
    expect([...SUPER_ADMIN_EMAILS]).toEqual([
      "mihir.jmtds@gmail.com",
      "jmt.altus@gmail.com",
    ]);
  });

  it("stores the configured emails already lowercased and trimmed", () => {
    // isSuperAdmin lowercases the input and compares by equality, so an entry
    // with stray case/whitespace would silently never match.
    for (const email of SUPER_ADMIN_EMAILS) {
      expect(email).toBe(email.trim().toLowerCase());
    }
  });
});
