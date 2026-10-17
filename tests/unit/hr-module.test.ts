import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  MODULE_CODE_DEFAULTS,
  resolveModuleAccess,
  type ResolvedGrants,
} from "@/lib/access/modules";
import { MODULES, MODULE_IDS, moduleForPath, moduleIdForPath } from "@/lib/nav-modules";

const NONE: ResolvedGrants = { everyone: {}, department: {}, employee: {} };
const STAFF = { isAdmin: false, isSuperAdmin: false };
const ADMIN = { isAdmin: true, isSuperAdmin: false };
const root = (p: string) => path.resolve(__dirname, "../..", p);
const read = (p: string) => readFileSync(root(p), "utf8");

describe("the HR module", () => {
  const hr = MODULES.find((m) => m.id === "hr")!;

  it("is registered once, last, with Policies, HR Help Desk, Attendance Import, Attendance Correction, then the Post-Appointment, During Employment, Appraisal Letters and Exit groups", () => {
    expect(MODULE_IDS.filter((id) => id === "hr")).toHaveLength(1);
    expect(MODULES[MODULES.length - 1]!.id).toBe("hr");
    expect(hr.label).toBe("HR");
    expect(hr.items.map((i) => [i.label, i.href])).toEqual([
      ["Policies", "/hr/policies"],
      ["HR Help Desk", "/hr/help-desk"],
      ["Attendance Import", "/hr/attendance-import"],
      ["Attendance Correction", "/hr/attendance-correction"],
      ["Post-Appointment", "/hr/post-appointment"],
      ["During Employment", "/hr/during-employment"],
      ["Appraisal Letters", "/hr/appraisal-letters"],
      ["Exit", "/hr/exit"],
    ]);
    expect(hr.landing).toBe("/hr/policies");
    // Not hidden: it gets a hub tile like the other modules.
    expect(hr.hiddenFromHub).toBeUndefined();
  });

  it("does not rename or duplicate any existing module", () => {
    expect(MODULES.map((m) => m.label)).toEqual([
      "WMS", "Employees", "Incentive Tracker", "Training", "Masters",
      "Targets & Forecasts", "Project Plan", "HR",
    ]);
    expect(new Set(MODULE_IDS).size).toBe(MODULE_IDS.length);
  });

  it("owns /hr/* and the old /salary/policy URL, but leaves the rest of /salary to Employees", () => {
    expect(moduleIdForPath("/hr/policies")).toBe("hr");
    expect(moduleIdForPath("/salary/policy")).toBe("hr");
    expect(moduleIdForPath("/salary")).toBe("employees");
    expect(moduleIdForPath("/salary/import")).toBe("employees");
    expect(moduleIdForPath("/salary/payslip/abc")).toBe("employees");
    // The rail follows the same rule, so the right items light up.
    expect(moduleForPath("/hr/policies").id).toBe("hr");
    expect(moduleForPath("/attendance").id).toBe("employees");
  });
});

describe("HR access does not widen anyone's access", () => {
  it("is closed to staff by default, exactly as Employees (where Policies used to live) is", () => {
    expect(MODULE_CODE_DEFAULTS.hr).toBe(false);
    expect(MODULE_CODE_DEFAULTS.hr).toBe(MODULE_CODE_DEFAULTS.employees);
    expect(resolveModuleAccess("hr", STAFF, NONE)).toEqual({ allowed: false, source: "default" });
  });

  it("lets admins in through the admin bypass, as for Employees", () => {
    expect(resolveModuleAccess("hr", ADMIN, NONE).allowed).toBe(true);
    expect(resolveModuleAccess("employees", ADMIN, NONE).allowed).toBe(true);
  });

  it("can be granted per person or department like any module, and an org-wide deny still applies to staff", () => {
    expect(resolveModuleAccess("hr", STAFF, { ...NONE, employee: { hr: true } }).allowed).toBe(true);
    expect(resolveModuleAccess("hr", STAFF, { ...NONE, department: { hr: true } }).allowed).toBe(true);
    expect(resolveModuleAccess("hr", STAFF, { ...NONE, everyone: { hr: false } }).allowed).toBe(false);
  });

  it("an Employees grant does not open HR (and an HR grant does not open Employees)", () => {
    const grants: ResolvedGrants = { ...NONE, employee: { employees: true } };
    expect(resolveModuleAccess("hr", STAFF, grants).allowed).toBe(false);
    const hrOnly: ResolvedGrants = { ...NONE, employee: { hr: true } };
    expect(resolveModuleAccess("employees", STAFF, hrOnly).allowed).toBe(false);
  });
});

describe("Policies under HR", () => {
  it("serves the existing page from /hr/policies, unchanged in what it does", () => {
    const page = read("app/(app)/hr/policies/page.tsx");
    // The same queries and signing component, and ONE publish form (admins only).
    expect(page).toMatch(/getCurrentPolicy/);
    expect(page.match(/<PolicyUploadForm/g)).toHaveLength(1);
    expect(page).toContain("me.isAdmin ? <PolicyUploadForm");
    expect(page).toMatch(/SignaturePad/);
    // Same guard it always had: any signed-in user may read; only admins see consent status / upload.
    expect(page).toMatch(/requireUser\(\)/);
    expect(page).toMatch(/me\.isAdmin/);
  });

  it("keeps the old URL working by redirecting it, with no data or logic of its own", () => {
    const old = read("app/(app)/salary/policy/page.tsx");
    expect(old).toMatch(/redirect\("\/hr\/policies"/);
    expect(old).not.toMatch(/getCurrentPolicy|requireUser|db\./);
  });

  it("moved the server actions with the page and kept their admin/user guards", () => {
    expect(existsSync(root("app/(app)/hr/policies/actions.ts"))).toBe(true);
    expect(existsSync(root("app/(app)/salary/policy/actions.ts"))).toBe(false);
    const actions = read("app/(app)/hr/policies/actions.ts");
    expect(actions).toMatch(/const PATH = "\/hr\/policies"/);
    expect(actions).toMatch(/requireAdmin\(\)/); // upload stays admin-only
    expect(actions).toMatch(/requireUser\(\)/); // consent stays per signed-in user
    // Nothing still imports the old location.
    for (const f of ["components/salary/policy-upload-form.tsx", "components/salary/signature-pad.tsx"]) {
      expect(read(f)).toMatch(/@\/app\/\(app\)\/hr\/policies\/actions/);
      expect(read(f)).not.toMatch(/salary\/policy\/actions/);
    }
  });

  it("is a hub tile after Admin and Forms, so it is the ninth on a full hub", () => {
    const hub = read("app/(app)/hub/page.tsx");
    expect(hub).toMatch(/m\.id !== "hr"/);
    expect(hub.indexOf('key: "forms"')).toBeGreaterThan(0);
    expect(hub.indexOf("hrModule && access.hr?.allowed")).toBeGreaterThan(hub.indexOf('key: "forms"'));
  });
});
