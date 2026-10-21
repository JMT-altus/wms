import { describe, expect, it } from "vitest";
import { PERMISSION_FIELDS, PERMISSION_FIELD_KEYS, isSensitivePermission, permissionFieldDef } from "@/db/enums";
import { FIELD_CODE_DEFAULTS, resolveFieldAccess, type ResolvedFieldGrants } from "@/lib/access/field-permissions";

// The permission rule engine (pure) for the Collection capabilities, and proof
// that the original field permissions resolve exactly as before.

const ORDINARY = ["collection.view", "collection.master.import", "collection.followup.write", "collection.confirmation.set", "collection.escalation.create"] as const;
const SENSITIVE = ["collection.coordinator.assign", "collection.commitments.view", "collection.commitments.edit", "collection.escalation.review", "collection.escalation.close"] as const;
const ORIGINAL = ["enquiry.quantity", "enquiry.avg_rate", "forecast.quantity", "forecast.avg_rate", "master.product", "master.customer"] as const;

const none = (): ResolvedFieldGrants => ({ everyone: {}, department: {}, employee: {} });
const plain = { isAdmin: false, isSuperAdmin: false };
const admin = { isAdmin: true, isSuperAdmin: false };
const superAdmin = { isAdmin: true, isSuperAdmin: true };

describe("registry", () => {
  it("has exactly the ten Collection capabilities, five of them sensitive with both bypasses off", () => {
    const collection = PERMISSION_FIELDS.map((f) => f.key).filter((k) => k.startsWith("collection."));
    expect(collection.sort()).toEqual([...ORDINARY, ...SENSITIVE].sort());
    for (const k of SENSITIVE) {
      expect(permissionFieldDef(k)).toMatchObject({ sensitive: true, adminBypass: false, superAdminBypass: false, defaultAllowed: false, group: "Collections" });
      expect(isSensitivePermission(k)).toBe(true);
    }
    for (const k of [...ORDINARY, ...ORIGINAL]) expect(isSensitivePermission(k)).toBe(false);
    for (const k of ORDINARY) expect(permissionFieldDef(k)).toMatchObject({ defaultAllowed: false, group: "Collections" });
  });

  it("knows only registered keys", () => {
    expect(PERMISSION_FIELD_KEYS.has("collection.commitments.view")).toBe(true);
    expect(PERMISSION_FIELD_KEYS.has("collection.anything")).toBe(false);
    expect(isSensitivePermission("collection.anything")).toBe(false);
    expect(permissionFieldDef("nope")).toBeUndefined();
  });

  it("holds no email, employee id or name — only keys, labels and rules", () => {
    expect(JSON.stringify(PERMISSION_FIELDS)).not.toMatch(/@|mihir|[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("ordinary Collection capabilities keep today's behaviour (every admin, unless denied)", () => {
  it.each(ORDINARY)("%s: admin and super-admin allowed by default; non-admin denied; explicit deny beats the admin default", (k) => {
    expect(resolveFieldAccess(k, admin, none())).toEqual({ allowed: true, source: "admin" });
    expect(resolveFieldAccess(k, superAdmin, none())).toEqual({ allowed: true, source: "super-admin" });
    expect(resolveFieldAccess(k, plain, none())).toEqual({ allowed: false, source: "default" });
    expect(resolveFieldAccess(k, admin, { ...none(), employee: { [k]: false } })).toEqual({ allowed: false, source: "employee" });
    expect(resolveFieldAccess(k, admin, { ...none(), department: { [k]: false } })).toEqual({ allowed: false, source: "department" });
    expect(resolveFieldAccess(k, plain, { ...none(), employee: { [k]: true } })).toEqual({ allowed: true, source: "employee" });
  });
});

describe("sensitive Collection capabilities need an explicit grant — for admins and super-admins too", () => {
  it.each(SENSITIVE)("%s: denied without a grant for everyone, including admin and super-admin", (k) => {
    for (const who of [plain, admin, superAdmin]) expect(resolveFieldAccess(k, who, none())).toEqual({ allowed: false, source: "default" });
  });

  it.each(SENSITIVE)("%s: an explicit person or org-wide grant allows it", (k) => {
    for (const who of [plain, admin, superAdmin]) {
      expect(resolveFieldAccess(k, who, { ...none(), employee: { [k]: true } })).toEqual({ allowed: true, source: "employee" });
      expect(resolveFieldAccess(k, who, { ...none(), everyone: { [k]: true } })).toEqual({ allowed: true, source: "everyone" });
    }
  });

  it.each(SENSITIVE)("%s: department rows — allow or deny — are ignored (no department layer)", (k) => {
    for (const who of [plain, admin, superAdmin]) {
      // A department Allow grants nothing…
      expect(resolveFieldAccess(k, who, { ...none(), department: { [k]: true } })).toEqual({ allowed: false, source: "default" });
      // …and (the recorded semantic change) a department Deny no longer narrows an org-wide grant…
      expect(resolveFieldAccess(k, who, { everyone: { [k]: true }, department: { [k]: false }, employee: {} })).toEqual({ allowed: true, source: "everyone" });
      // …while a person-level Deny still does.
      expect(resolveFieldAccess(k, who, { everyone: { [k]: true }, department: { [k]: true }, employee: { [k]: false } })).toEqual({ allowed: false, source: "employee" });
    }
  });

  it.each(SENSITIVE)("%s: precedence is deterministic — person beats org-wide; revoked = default", (k) => {
    expect(resolveFieldAccess(k, superAdmin, { everyone: { [k]: true }, department: {}, employee: { [k]: false } })).toEqual({ allowed: false, source: "employee" });
    expect(resolveFieldAccess(k, admin, { everyone: { [k]: false }, department: {}, employee: { [k]: true } })).toEqual({ allowed: true, source: "employee" });
    // Revoked (row removed) = back to the default: denied.
    expect(resolveFieldAccess(k, superAdmin, none()).allowed).toBe(false);
  });

  it.each(ORDINARY)("%s: ordinary department grants are unchanged (allow and deny both apply)", (k) => {
    expect(resolveFieldAccess(k, plain, { ...none(), department: { [k]: true } })).toEqual({ allowed: true, source: "department" });
    expect(resolveFieldAccess(k, admin, { everyone: { [k]: true }, department: { [k]: false }, employee: {} })).toEqual({ allowed: false, source: "department" });
  });

  it("review and close are independent; view and edit are independent", () => {
    const g = (k: string) => ({ ...none(), employee: { [k]: true } });
    expect(resolveFieldAccess("collection.escalation.close", admin, g("collection.escalation.review")).allowed).toBe(false);
    expect(resolveFieldAccess("collection.escalation.review", admin, g("collection.escalation.close")).allowed).toBe(false);
    expect(resolveFieldAccess("collection.commitments.edit", admin, g("collection.commitments.view")).allowed).toBe(false);
    expect(resolveFieldAccess("collection.commitments.view", admin, g("collection.commitments.edit")).allowed).toBe(false);
  });
});

describe("the original field permissions resolve exactly as before", () => {
  // The resolver as it was before this change, verbatim in behaviour.
  const before = (key: string, s: { isAdmin: boolean; isSuperAdmin: boolean }, g: ResolvedFieldGrants) => {
    if (s.isSuperAdmin) return { allowed: true, source: "super-admin" };
    if (g.employee[key] !== undefined) return { allowed: g.employee[key], source: "employee" };
    if (g.department[key] !== undefined) return { allowed: g.department[key], source: "department" };
    if (s.isAdmin) return { allowed: true, source: "admin" };
    if (g.everyone[key] !== undefined) return { allowed: g.everyone[key], source: "everyone" };
    return { allowed: FIELD_CODE_DEFAULTS[key] ?? false, source: "default" };
  };
  const levels = [undefined, true, false] as const;
  it.each(ORIGINAL)("%s: every subject × every grant combination", (k) => {
    for (const who of [plain, admin, superAdmin])
      for (const e of levels)
        for (const d of levels)
          for (const o of levels) {
            const g: ResolvedFieldGrants = {
              employee: e === undefined ? {} : { [k]: e },
              department: d === undefined ? {} : { [k]: d },
              everyone: o === undefined ? {} : { [k]: o },
            };
            expect(resolveFieldAccess(k, who, g)).toEqual(before(k, who, g));
          }
  });
});
