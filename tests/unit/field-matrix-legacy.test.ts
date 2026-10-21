import { describe, expect, it, vi } from "vitest";

// getFieldMatrix reports department-level rows on SENSITIVE permissions (which
// the resolver ignores) for review — read-only. Database MOCKED.
const DEPT = "33333333-3333-4333-8333-333333333333";
const GONE = "44444444-4444-4444-8444-444444444444";
const grants = [
  { fieldKey: "collection.commitments.view", subjectType: "department", subjectId: DEPT, allowed: true },
  { fieldKey: "collection.escalation.close", subjectType: "department", subjectId: GONE, allowed: false },
  { fieldKey: "collection.followup.write", subjectType: "department", subjectId: DEPT, allowed: false }, // ordinary
  { fieldKey: "collection.commitments.view", subjectType: "employee", subjectId: "e1", allowed: true }, // person
  { fieldKey: "collection.commitments.edit", subjectType: "everyone", subjectId: null, allowed: true }, // org-wide
];
const writes: string[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    // employees: select().from().where().orderBy(); grants: select().from() (awaited directly)
    select: () => ({
      from: () =>
        Object.assign(Promise.resolve(grants), {
          where: () => ({ orderBy: async () => [] }),
        }),
    }),
    execute: async () => [{ id: DEPT, name: "Accounts" }],
    insert: () => writes.push("insert"),
    update: () => writes.push("update"),
    delete: () => writes.push("delete"),
  },
}));

import { getFieldMatrix } from "@/lib/queries/master-data";

describe("getFieldMatrix — legacy sensitive department grants", () => {
  it("lists exactly the department rows on sensitive keys, with department names, and changes nothing", async () => {
    const m = await getFieldMatrix();
    expect(m.legacyDepartmentSensitiveGrants).toEqual([
      { fieldKey: "collection.commitments.view", departmentId: DEPT, departmentName: "Accounts", allowed: true },
      { fieldKey: "collection.escalation.close", departmentId: GONE, departmentName: null, allowed: false },
    ]);
    expect(m.grants).toHaveLength(grants.length); // all rows still returned to the matrix as-is
    expect(writes).toEqual([]);
  });
});
