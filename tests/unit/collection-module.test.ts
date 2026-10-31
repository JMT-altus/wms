import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Collection is its own HUB module (/collection), moved out of Forms:
//   - registered like every other module, off by default, so it appears in Admin → Access and nobody gets it by code;
//   - its rail carries exactly the sections Forms used to list, gated by the same collection.* capabilities;
//   - Forms no longer lists any Collection section; the old URLs redirect;
//   - the Collection guards need the MODULE first, then the capability — a module grant alone opens nothing.
// Session, grants and module access are MOCKED; nothing touches a database.
const h = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string },
  /** What Admin → Access resolved for the Collection module. */
  module: false,
  /** The collection.* capabilities the matrix resolved. */
  caps: new Set<string>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => {
    if (!h.me?.isActive) throw new Error("NEXT_REDIRECT:/login");
    return h.me;
  },
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries([...h.caps].map((k) => [k, { allowed: true, source: "employee" }])),
}));
vi.mock("@/lib/auth/module-access", () => ({
  canAccessModule: async (id: string) => id === "collection" && h.module,
  requireModuleAccess: async (id: string) => {
    if (!(id === "collection" && h.module)) throw new Error(`NEXT_REDIRECT:/hub?denied=${id}`);
    return h.me;
  },
}));

import { MODULES, MODULE_IDS, moduleIdForPath } from "@/lib/nav-modules";
import { MODULE_CODE_DEFAULTS, resolveModuleAccess } from "@/lib/access/modules";
import { navFor as collectionNav } from "@/components/collections/collection-sidebar";
import { navFor as formsNav } from "@/components/forms/forms-sidebar";
import { getCollectionCapabilities, getCollectionCapability, requireCollectionCapability } from "@/lib/auth/capability";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const SECTIONS = ["/collection/dashboard", "/collection/tracker", "/collection/master", "/collection/commitments", "/collection/logs"];

beforeEach(() => {
  h.me = { id: "emp-1", email: "one@example.test", isActive: true, isAdmin: false, name: "One" };
  h.module = false;
  h.caps = new Set();
});

describe("the Collection module is registered like the others", () => {
  it("is a separate hub module with its own landing, routes and icon, placed alongside the others (before HR)", () => {
    const m = MODULES.find((x) => x.id === "collection")!;
    expect(m).toMatchObject({ label: "Collection", landing: "/collection/dashboard", icon: "HandCoins", items: [] });
    expect(m.hiddenFromHub).toBeUndefined();
    expect(MODULES.map((x) => x.id).indexOf("collection")).toBe(MODULES.map((x) => x.id).indexOf("hr") - 1);
    expect(new Set(MODULE_IDS).size).toBe(MODULE_IDS.length);
  });

  it("every Collection URL — and the old Forms URL — belongs to it, not to WMS or Forms", () => {
    for (const p of [...SECTIONS, "/collection", "/collection/master/abc", "/collection/logs/xyz", "/forms/collection/tracker"]) {
      expect(moduleIdForPath(p), p).toBe("collection");
    }
    expect(moduleIdForPath("/forms/client-kyc/new")).toBe("wms"); // Client KYC is unchanged
  });

  it("is OFF by default: nobody is granted it by code, admins pass through the admin bypass, a person-level deny beats that", () => {
    expect(MODULE_CODE_DEFAULTS.collection).toBe(false);
    const none = { everyone: {}, department: {}, employee: {} };
    expect(resolveModuleAccess("collection", { isAdmin: false, isSuperAdmin: false }, none)).toEqual({ allowed: false, source: "default" });
    expect(resolveModuleAccess("collection", { isAdmin: true, isSuperAdmin: false }, none)).toEqual({ allowed: true, source: "admin" });
    expect(resolveModuleAccess("collection", { isAdmin: false, isSuperAdmin: false }, { ...none, employee: { collection: true } })).toEqual({ allowed: true, source: "employee" });
    expect(resolveModuleAccess("collection", { isAdmin: true, isSuperAdmin: false }, { ...none, employee: { collection: false } })).toEqual({ allowed: false, source: "employee" });
  });

  it("appears in the Admin → Access matrix with an icon, and the hub has a tile style for it", () => {
    expect(read("components/admin/access-manager.tsx")).toMatch(/collection: HandCoins/);
    expect(read("app/(app)/hub/page.tsx")).toMatch(/collection: \{ Icon: HandCoins/);
  });
});

describe("navigation", () => {
  it("the Collection rail lists the sections Forms used to, under the Collection heading, each by its capability", () => {
    const hrefs = (items: ReadonlyArray<{ href: string }>) => items.map((i) => String(i.href));
    expect(hrefs(collectionNav(false, true))).toEqual(["/collection/dashboard", "/collection/tracker", "/collection/master"]);
    expect(hrefs(collectionNav(true, true, true))).toEqual(SECTIONS);
    expect(collectionNav(true, true, true)[0]!.groupLabel).toBe("Collection");
    // Without collection.view the restricted pages still list, with the heading.
    expect(hrefs(collectionNav(true, false, true))).toEqual(["/collection/commitments", "/collection/logs"]);
    expect(collectionNav(true, false, true)[0]!.groupLabel).toBe("Collection");
    expect(collectionNav(false, false)).toEqual([]);
  });

  it("the Forms rail no longer carries any Collection section — Client KYC only", () => {
    const hrefs = formsNav().map((i) => String(i.href));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((p) => p.startsWith("/forms/client-kyc/"))).toBe(true);
    expect(read("components/forms/forms-sidebar.tsx")).not.toMatch(/\/collection\//);
    expect(read("app/(forms-module)/forms/layout.tsx")).not.toMatch(/getCollectionCapabilities|showCollection/);
  });

  it("the Collection pages live under the module's own layout, which requires the module; no page is left under Forms", () => {
    const layout = read("app/(collection-module)/collection/layout.tsx");
    expect(layout).toMatch(/requireModuleAccess\("collection"\)/);
    expect(layout).toMatch(/showLogs = caps\["collection\.logs\.view"\]/);
    for (const p of ["dashboard/page.tsx", "tracker/page.tsx", "master/page.tsx", "commitments/page.tsx", "logs/page.tsx", "page.tsx"]) {
      expect(() => read(`app/(collection-module)/collection/${p}`), p).not.toThrow();
      expect(() => read(`app/(forms-module)/forms/collection/${p}`), p).toThrow();
    }
    expect(read("app/(collection-module)/collection/page.tsx")).toMatch(/redirect\("\/collection\/dashboard"/);
  });

  it("the old Forms URLs redirect to the new module, so bookmarks and deep links keep working", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/source: "\/forms\/collection\/:path\*", destination: "\/collection\/:path\*"/);
    expect(cfg).toMatch(/source: "\/forms\/collection", destination: "\/collection\/dashboard"/);
    // No code still points at the old home.
    expect(read("components/collections/collection-logs.tsx")).not.toMatch(/forms\/collection/);
    expect(read("lib/collections/weekly-upload/week.ts")).toMatch(/TRACKER_PATH = "\/collection\/tracker"/);
  });
});

describe("authorization — module first, then the section's own capability", () => {
  it("without the module nobody gets in, admin or not, whatever capabilities they hold", async () => {
    h.caps = new Set(["collection.view", "collection.followup.write"]);
    for (const admin of [false, true]) {
      h.me = { ...h.me!, isAdmin: admin };
      h.module = false; // not granted (or explicitly denied in Admin → Access)
      await expect(requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
      expect(await getCollectionCapability("collection.view")).toBeNull();
      expect(Object.values(await getCollectionCapabilities()).every((v) => v === false)).toBe(true);
    }
  });

  it("the module alone grants no section: a non-admin with the module and no capability is still refused", async () => {
    h.module = true;
    await expect(requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
    await expect(requireCollectionCapability("collection.balances.import")).rejects.toThrow("Forbidden");
    expect(await getCollectionCapability("collection.view")).toBeNull();
    expect(Object.values(await getCollectionCapabilities()).every((v) => v === false)).toBe(true);
  });

  it("the module plus a capability opens exactly that section, for a non-admin too — the proof names the session's employee", async () => {
    h.module = true;
    h.caps = new Set(["collection.view"]);
    expect(await requireCollectionCapability("collection.view")).toEqual({ employeeId: "emp-1", capability: "collection.view" });
    await expect(requireCollectionCapability("collection.master.import")).rejects.toThrow("Forbidden");
    const caps = await getCollectionCapabilities();
    expect(caps["collection.view"]).toBe(true);
    expect(caps["collection.master.import"]).toBe(false);
  });

  it("revoking the module stops the next request even though the capabilities are untouched", async () => {
    h.module = true;
    h.caps = new Set(["collection.view"]);
    expect((await requireCollectionCapability("collection.view")).capability).toBe("collection.view");
    h.module = false;
    await expect(requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
    expect(h.caps.has("collection.view")).toBe(true);
  });

  it("a signed-out or deactivated session holds nothing", async () => {
    h.module = true;
    h.caps = new Set(["collection.view"]);
    h.me = null;
    await expect(requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
    h.me = { id: "emp-1", email: "one@example.test", isActive: false, isAdmin: true, name: "One" };
    await expect(requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
  });

  it("no employee name, email or id is built into the module, the rail or the guards", () => {
    for (const f of ["lib/nav-modules.ts", "lib/access/modules.ts", "lib/auth/capability.ts", "components/collections/collection-sidebar.tsx", "app/(collection-module)/collection/layout.tsx"]) {
      expect(read(f), f).not.toMatch(/@example|@gmail|mihir|bhavisha|[0-9a-f]{8}-[0-9a-f]{4}-4/i);
    }
  });
});
