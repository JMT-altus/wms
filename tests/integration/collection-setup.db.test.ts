import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// capabilityHolders() on a REAL (in-memory PGlite) database — nothing here can reach a shared or production
// database. It reports who holds the setup-hint capabilities by an explicit Allow, for the super-admin's notice.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let capabilityHolders: typeof import("@/lib/queries/collection-setup").capabilityHolders;
const ids: Record<string, string> = {};
const REVIEW = "collection.escalation.review";
const ASSIGN = "collection.coordinator.assign";

const grant = (key: string, type: string, subject: string | null, allowed = true) =>
  pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, $2, $3, $4)`, [key, type, subject, allowed]);
const wipe = () => pg.exec(`delete from field_permission_grants`);

beforeAll(async () => {
  const made = await createTestDb({ employees: schema.employees, departments: schema.departments, fieldPermissionGrants: schema.fieldPermissionGrants });
  pg = made.pg;
  h.db = made.db;
  const emp = async (k: string, active: boolean, admin: boolean) => {
    ids[k] = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_active, is_admin) values ($1, $2, 'both', $3, $4) returning id`, [k, `${k}@example.test`, active, admin])).rows[0]!.id;
  };
  await emp("adminA", true, true);
  await emp("adminB", true, true);
  await emp("inactiveAdmin", false, true);
  await emp("plainStaff", true, false);
  ids.dept = (await pg.query<{ id: string }>(`insert into departments (name) values ('Accounts') returning id`)).rows[0]!.id;
  ({ capabilityHolders } = await import("@/lib/queries/collection-setup"));
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("capabilityHolders", () => {
  it("with no grants at all: nobody holds either capability", async () => {
    await wipe();
    expect(await capabilityHolders()).toEqual({ [REVIEW]: { people: 0, orgWide: false }, [ASSIGN]: { people: 0, orgWide: false } });
  });

  it("counts active admins with a person-level Allow, per capability", async () => {
    await wipe();
    await grant(REVIEW, "employee", ids.adminA!);
    await grant(REVIEW, "employee", ids.adminB!);
    await grant(ASSIGN, "employee", ids.adminA!);
    expect(await capabilityHolders()).toEqual({ [REVIEW]: { people: 2, orgWide: false }, [ASSIGN]: { people: 1, orgWide: false } });
  });

  it("ignores denies, inactive employees, non-admins (the Forms area is admin-only) and department rows (ignored by the resolver)", async () => {
    await wipe();
    await grant(REVIEW, "employee", ids.adminA!, false); // explicit deny
    await grant(REVIEW, "employee", ids.inactiveAdmin!); // deactivated
    await grant(REVIEW, "employee", ids.plainStaff!); // not an admin
    await grant(REVIEW, "department", ids.dept!); // legacy department row
    expect(await capabilityHolders()).toEqual({ [REVIEW]: { people: 0, orgWide: false }, [ASSIGN]: { people: 0, orgWide: false } });
  });

  it("reports an organisation-wide Allow separately", async () => {
    await wipe();
    await grant(ASSIGN, "everyone", null);
    expect(await capabilityHolders()).toEqual({ [REVIEW]: { people: 0, orgWide: false }, [ASSIGN]: { people: 0, orgWide: true } });
  });

  it("returns null (so no notice is shown) if the grants can't be read — and never throws", async () => {
    const real = h.db;
    h.db = {
      select: () => {
        throw new Error("connection lost");
      },
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await capabilityHolders()).toBeNull();
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/connection lost/);
    err.mockRestore();
    h.db = real;
  });
});
