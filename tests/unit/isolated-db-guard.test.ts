import { describe, expect, it } from "vitest";
import { refuseUnlessIsolated } from "../integration/_isolated-db";

// The guard that keeps integration tests off shared databases. No connection is made.
describe("refuseUnlessIsolated", () => {
  it("accepts a local database or one named for tests", () => {
    expect(refuseUnlessIsolated("postgres://u:p@localhost:5432/wms")).toBeNull();
    expect(refuseUnlessIsolated("postgres://u:p@127.0.0.1:5433/anything")).toBeNull();
    expect(refuseUnlessIsolated("postgres://u:p@db.example.test:5432/wms_test")).toBeNull();
  });
  it("refuses a remote database that isn't named for tests, and anything unparsable or unset", () => {
    expect(refuseUnlessIsolated("postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")).toMatch(/local database/);
    expect(refuseUnlessIsolated("not a url")).toMatch(/not a valid URL/);
    expect(refuseUnlessIsolated(undefined)).toMatch(/not set/);
  });
  it("never echoes the URL it was given", () => {
    const secret = "postgres://user:SuperSecret123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    expect(refuseUnlessIsolated(secret)).not.toContain("SuperSecret123");
  });
});
