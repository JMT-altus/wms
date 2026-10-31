import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Forms is a module in Admin → Access like every other: Auto / On / Off, off by default for staff, checked on the hub,
// the layout, the pages, the server actions and the export routes — and independent of Collection. Session and resolved
// module access are MOCKED; nothing touches a database.
const h = vi.hoisted(() => ({
  me: null as null | { id: string; name: string; email: string; isAdmin: boolean; isActive: boolean },
  modules: new Set<string>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/current", () => ({ getCurrentEmployee: async () => h.me }));
vi.mock("@/lib/auth/module-access", () => ({
  canAccessModule: async (m: string) => h.modules.has(m),
  getMyModuleAccess: async () => Object.fromEntries(["wms", "employees", "sales", "training", "masters", "targets", "project", "forms", "collection", "hr"].map((m) => [m, { allowed: h.modules.has(m), source: "employee" }])),
  requireModuleAccess: async (m: string) => {
    if (!h.modules.has(m)) throw new Error(`NEXT_REDIRECT:/hub?denied=${m}`);
    return h.me;
  },
}));
vi.mock("@/lib/queries/org-settings", () => ({ getOrgSettings: async () => ({ idleTimeoutMinutes: 10 }) }));
vi.mock("@/components/auth/idle-timer-client", () => ({ IdleTimerClient: () => null }));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/components/forms/forms-sidebar", () => ({ FormsSidebar: () => null, FormsMobileNav: () => null }));
vi.mock("@/components/header/user-menu-server", () => ({ UserMenuServer: () => null }));
vi.mock("@/components/attendance/leave/pending-leave-prompt-server", () => ({ PendingLeavePromptServer: () => null }));
vi.mock("@/lib/queries/client-kyc", () => ({ listClientMasterRows: vi.fn(async () => { throw new Error("the database must not be reached"); }) }));

import { MODULES, MODULE_IDS, moduleIdForPath } from "@/lib/nav-modules";
import { MODULE_CODE_DEFAULTS, levelToAllowed, resolveModuleAccess, type ResolvedGrants } from "@/lib/access/modules";
import { SetModuleAccessSchema } from "@/lib/validators/module-access";
import HubPage from "@/app/(app)/hub/page";
import FormsLayout from "@/app/(forms-module)/forms/layout";
import { addKycLookupOption } from "@/app/(forms-module)/forms/client-kyc/actions";
import { GET as exportXlsx } from "@/app/(forms-module)/forms/client-kyc/export.xlsx/route";
import { GET as exportPdf } from "@/app/(forms-module)/forms/client-kyc/export.pdf/route";
import { GET as template } from "@/app/(forms-module)/forms/client-kyc/client-template.xlsx/route";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const staff = { isAdmin: false, isSuperAdmin: false };
const admin = { isAdmin: true, isSuperAdmin: false };
const none = (): ResolvedGrants => ({ everyone: {}, department: {}, employee: {} });

const tiles = async () => {
  const html = renderToStaticMarkup(await HubPage({ searchParams: Promise.resolve({}) }));
  return [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
};

beforeEach(() => {
  h.me = { id: "e1", name: "Staff One", email: "one@example.test", isAdmin: false, isActive: true };
  h.modules = new Set();
});

describe("registered like every other module", () => {
  it("is a module of its own, so the Access matrix lists it with an icon and accepts its settings", () => {
    expect(MODULE_IDS).toContain("forms");
    expect(MODULES.find((m) => m.id === "forms")).toMatchObject({ label: "Forms", landing: "/forms", routes: ["/forms"], tagline: "Client KYC, masters and Tally ledgers." });
    expect(read("components/admin/access-manager.tsx")).toMatch(/forms: FileText/);
    for (const level of ["inherit", "allow", "deny"] as const) {
      expect(SetModuleAccessSchema.parse({ moduleId: "forms", subjectType: "everyone", level }).moduleId).toBe("forms");
    }
  });

  it("every Forms URL belongs to it; the old Collection URLs still belong to Collection", () => {
    expect(moduleIdForPath("/forms/client-kyc/new")).toBe("forms");
    expect(moduleIdForPath("/forms/client-kyc/clients")).toBe("forms");
    for (const p of ["/forms", "/forms/customer-master", "/forms/vendor-master", "/forms/tally-import", "/forms/documents/sales-orders", "/forms/outstanding/payables"]) expect(moduleIdForPath(p), p).toBe("forms");
    expect(moduleIdForPath("/forms/collection/tracker")).toBe("collection");
    expect(moduleIdForPath("/collection/tracker")).toBe("collection");
  });

  it("Auto is hidden for staff (nobody is granted it by code), open to admins through the existing bypass", () => {
    expect(MODULE_CODE_DEFAULTS.forms).toBe(false);
    expect(resolveModuleAccess("forms", staff, none())).toEqual({ allowed: false, source: "default" });
    expect(resolveModuleAccess("forms", admin, none())).toEqual({ allowed: true, source: "admin" });
  });

  it("On makes it visible to staff; Off hides it; Auto removes the row — each independently of Collection", () => {
    const everyone = (level: "allow" | "deny" | "inherit"): ResolvedGrants => {
      const v = levelToAllowed(level);
      return { ...none(), everyone: v === null ? {} : { forms: v } };
    };
    expect(resolveModuleAccess("forms", staff, everyone("allow"))).toEqual({ allowed: true, source: "everyone" });
    expect(resolveModuleAccess("forms", staff, everyone("deny"))).toEqual({ allowed: false, source: "everyone" });
    expect(resolveModuleAccess("forms", staff, everyone("inherit")).allowed).toBe(false);
    expect(resolveModuleAccess("collection", staff, everyone("allow")).allowed).toBe(false);
    expect(resolveModuleAccess("forms", staff, { ...none(), everyone: { collection: true } }).allowed).toBe(false);
    // The same org-wide row leaves every other module exactly as it was.
    for (const m of MODULE_IDS.filter((x) => x !== "forms")) {
      expect(resolveModuleAccess(m, staff, everyone("allow")), m).toEqual(resolveModuleAccess(m, staff, none()));
    }
    // A person-level Off restricts an admin too, as for every module.
    expect(resolveModuleAccess("forms", admin, { ...none(), employee: { forms: false } })).toEqual({ allowed: false, source: "employee" });
  });
});

describe("the hub follows module access, not the admin flag", () => {
  it("shows the Forms tile only with access, for staff and admins alike", async () => {
    expect(await tiles()).not.toContain("/forms");
    h.modules = new Set(["forms"]);
    expect(await tiles()).toContain("/forms");
    h.me = { ...h.me!, isAdmin: true };
    h.modules = new Set();
    expect(await tiles()).not.toContain("/forms");
  });

  it("Forms and Collection tiles appear independently; Admin & Master Setup is still admin-only", async () => {
    h.modules = new Set(["collection"]);
    let t = await tiles();
    expect(t).toContain("/collection/dashboard");
    expect(t).not.toContain("/forms");
    h.modules = new Set(["forms"]);
    t = await tiles();
    expect(t).not.toContain("/collection/dashboard");
    expect(t).toContain("/forms");
    expect(t).not.toContain("/master-setup");
  });

  it("keeps its place on a full hub: after Admin & Master Setup, before HR, one tile only", async () => {
    h.me = { ...h.me!, isAdmin: true };
    h.modules = new Set(MODULE_IDS);
    const t = (await tiles()).filter((x) => ["/master-setup", "/forms", "/hr/policies"].includes(x!));
    expect(t).toEqual(["/master-setup", "/forms", "/hr/policies"]);
  });
});

describe("no way around it", () => {
  const children = null;

  it("the layout every Forms page passes through bounces someone without access to the hub", async () => {
    await expect(FormsLayout({ children })).rejects.toThrow("NEXT_REDIRECT:/hub?denied=forms");
    h.me = { ...h.me!, isAdmin: true }; // an admin denied Forms in Access
    await expect(FormsLayout({ children })).rejects.toThrow("NEXT_REDIRECT:/hub?denied=forms");
    h.modules = new Set(["forms"]);
    await expect(FormsLayout({ children })).resolves.toBeTruthy();
  });

  it("Collection access does not open Forms, and revoking stops the next request", async () => {
    h.modules = new Set(["collection"]);
    await expect(FormsLayout({ children })).rejects.toThrow("denied=forms");
    h.modules = new Set(["forms"]);
    await expect(FormsLayout({ children })).resolves.toBeTruthy();
    h.modules = new Set();
    await expect(FormsLayout({ children })).rejects.toThrow("denied=forms");
  });

  it("server actions refuse before touching the database", async () => {
    expect(await addKycLookupOption("x" as never, "New option")).toEqual({ ok: false, error: "You don't have access to Forms." });
    h.me = { ...h.me!, isAdmin: true };
    expect(await addKycLookupOption("x" as never, "New option")).toEqual({ ok: false, error: "You don't have access to Forms." });
  });

  it("the export and template routes answer 403 by direct URL", async () => {
    expect((await exportXlsx()).status).toBe(403);
    expect((await exportPdf()).status).toBe(403);
    expect((await template(new Request("http://x.test/forms/client-kyc/client-template.xlsx"))).status).toBe(403);
    h.modules = new Set(["collection"]);
    expect((await exportXlsx()).status).toBe(403);
  });

  it("every Forms guard uses the module and no admin gate is left; the Collection guards don't mention Forms", () => {
    const base = "app/(forms-module)/forms/client-kyc";
    for (const f of [`${base}/actions.ts`, `${base}/cust-dropdown/actions.ts`, `${base}/export.xlsx/route.ts`, `${base}/export.pdf/route.ts`, `${base}/client-template.xlsx/route.ts`]) {
      expect(read(f), f).toMatch(/canAccessModule\("forms"\)/);
    }
    for (const f of [`${base}/drafts/page.tsx`, `${base}/recycle-bin/page.tsx`, "app/(forms-module)/forms/layout.tsx"]) {
      expect(read(f), f).toMatch(/requireModuleAccess\("forms"\)/);
      expect(read(f), f).not.toMatch(/await requireAdmin\(/);
    }
    expect(read("lib/auth/capability.ts")).not.toMatch(/"forms"/);
    expect(read("app/(collection-module)/collection/layout.tsx")).not.toMatch(/"forms"/);
  });
});
