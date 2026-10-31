import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Client KYC Draft and Recycle Bin pages run the expiry sweep (a WRITE).
// These prove the write can't happen during a build's static pre-render or for a
// request that isn't someone with the Forms module. Mocked: the pages' collaborators only.
const h = vi.hoisted(() => ({
  calls: [] as string[],
  admin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/module-access", () => ({
  requireModuleAccess: async () => {
    h.calls.push("requireModuleAccess");
    return h.admin();
  },
}));
vi.mock("@/lib/masters/draft-sweep", () => ({
  sweepExpiredDraftsQuietly: async () => {
    h.calls.push("sweep");
  },
}));
vi.mock("@/lib/queries/client-kyc", () => ({
  listClientDrafts: async () => {
    h.calls.push("list");
    return [];
  },
  listRecycledClients: async () => {
    h.calls.push("list");
    return [];
  },
}));
vi.mock("@/lib/db/retry", () => ({ withDbRetry: (_label: string, fn: () => unknown) => fn() }));
vi.mock("@/components/forms/client-kyc-stage-list", () => ({ ClientKycStageList: () => null }));

import DraftsPage, * as draftsModule from "@/app/(forms-module)/forms/client-kyc/drafts/page";
import RecyclePage, * as recycleModule from "@/app/(forms-module)/forms/client-kyc/recycle-bin/page";

/**
 * What Next does while pre-rendering a page at build time: reading request
 * cookies (inside requireModuleAccess → readSession) throws a dynamic-usage signal
 * that stops the render. Modelled here as requireModuleAccess throwing.
 */
class DynamicServerUsage extends Error {
  digest = "DYNAMIC_SERVER_USAGE";
}

beforeEach(() => {
  h.calls = [];
  h.admin.mockReset();
});

describe.each([
  ["Draft", DraftsPage, draftsModule],
  ["Recycle Bin", RecyclePage, recycleModule],
] as const)("Client KYC %s page", (_name, Page, mod) => {
  it("is never statically pre-rendered", () => {
    expect((mod as { dynamic?: string }).dynamic).toBe("force-dynamic");
  });

  it("build-time render: the session read stops it before the sweep — no write", async () => {
    h.admin.mockImplementation(() => {
      throw new DynamicServerUsage("Route used cookies()");
    });
    await expect(Page()).rejects.toBeInstanceOf(DynamicServerUsage);
    expect(h.calls).toEqual(["requireModuleAccess"]);
  });

  it("a request that isn't someone with the Forms module never sweeps", async () => {
    h.admin.mockImplementation(() => {
      throw new Error("Forbidden");
    });
    await expect(Page()).rejects.toThrow("Forbidden");
    expect(h.calls).not.toContain("sweep");
  });

  it("an admin's request still sweeps first, then reads the list (behaviour preserved)", async () => {
    h.admin.mockResolvedValue({ id: "a", isAdmin: true });
    await Page();
    expect(h.calls).toEqual(["requireModuleAccess", "sweep", "list"]);
  });
});

describe("source guard", () => {
  it("no page or layout runs the KYC sweep without a Forms access check first, and none is statically rendered", () => {
    for (const f of [
      "app/(forms-module)/forms/client-kyc/drafts/page.tsx",
      "app/(forms-module)/forms/client-kyc/recycle-bin/page.tsx",
    ]) {
      const src = readFileSync(resolve(__dirname, "../..", f), "utf8");
      expect(src, f).toMatch(/export const dynamic = "force-dynamic"/);
      const auth = src.indexOf("await requireModuleAccess(\"forms\")");
      const sweep = src.indexOf("await sweepExpiredDraftsQuietly()");
      expect(auth, f).toBeGreaterThan(-1);
      expect(sweep, f).toBeGreaterThan(auth);
    }
  });
});
