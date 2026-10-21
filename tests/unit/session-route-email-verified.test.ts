import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/auth/session — linking a Firebase account to an employee row
// requires the verified-email claim of the cryptographically verified ID token.
// MOCKED: Firebase Admin (verifyIdToken), the database, cookie minting. Nothing
// here contacts Firebase or a database.
const h = vi.hoisted(() => {
  // Made-up placeholders: cookie minting is mocked, but the route reads these to build its options.
  process.env.FIREBASE_PRIVATE_KEY = "test-placeholder-key";
  process.env.FIREBASE_PROJECT_ID = "test-project";
  process.env.FIREBASE_CLIENT_EMAIL = "service@test.invalid";
  process.env.COOKIE_SECRET_CURRENT = "test-cookie-secret-current";
  process.env.COOKIE_SECRET_PREVIOUS = "test-cookie-secret-previous";
  return {
    decoded: null as null | Record<string, unknown>,
    employee: null as null | Record<string, unknown>,
    updates: [] as Record<string, unknown>[],
    sessionRows: [] as Record<string, unknown>[],
    cookiesMinted: 0,
  };
});
vi.mock("@/lib/firebase/admin", () => ({
  getFirebaseAdminAuth: () => ({
    verifyIdToken: async () => {
      if (!h.decoded) throw new Error("bad token");
      return h.decoded;
    },
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: { employees: { findFirst: async () => h.employee ?? undefined } },
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          h.updates.push(v);
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          h.sessionRows.push(v);
        },
      }),
    }),
  },
}));
vi.mock("next-firebase-auth-edge/next/cookies", () => ({
  setAuthCookies: async () => {
    h.cookiesMinted++;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "set-cookie": "__session=minted" } });
  },
}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/cache-tags", () => ({ PROFILE_CACHE_TAGS: { authSessions: (id: string) => `sessions:${id}` } }));

import { POST } from "@/app/api/auth/session/route";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown = { idToken: "header.payload.signature" }) =>
  POST(new Request("https://wms.example.test/api/auth/session", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const employee = (firebaseUid: string | null, over: Record<string, unknown> = {}) => ({
  id: EMPLOYEE,
  email: "person@example.test",
  isActive: true,
  firebaseUid,
  passwordResetByAdminAt: null,
  joinedAt: new Date("2026-01-01"),
  ...over,
});
const token = (over: Record<string, unknown>) => ({ uid: "fb-new", email: "person@example.test", ...over });
/** Refused: the existing not-enrolled response, and nothing written, tracked or minted. */
const expectRefusedWithoutSideEffects = async (res: Response) => {
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "not-enrolled" });
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(h.updates).toEqual([]);
  expect(h.sessionRows).toEqual([]);
  expect(h.cookiesMinted).toBe(0);
};

beforeEach(() => {
  h.decoded = null;
  h.employee = null;
  h.updates = [];
  h.sessionRows = [];
  h.cookiesMinted = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("linking an unlinked employee", () => {
  it("verified email: links the UID, records the session and mints the cookie", async () => {
    h.employee = employee(null);
    h.decoded = token({ email_verified: true });
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ firebaseUid: "fb-new" }]);
    expect(h.sessionRows).toEqual([expect.objectContaining({ employeeId: EMPLOYEE, firebaseUid: "fb-new" })]);
    expect(h.cookiesMinted).toBe(1);
  });

  it("unverified email: refused, no write", async () => {
    h.employee = employee(null);
    h.decoded = token({ email_verified: false });
    await expectRefusedWithoutSideEffects(await call());
  });

  it("missing email_verified claim: refused, no write", async () => {
    h.employee = employee(null);
    h.decoded = token({});
    await expectRefusedWithoutSideEffects(await call());
  });

  it("a truthy non-boolean claim is not accepted", async () => {
    h.employee = employee(null);
    h.decoded = token({ email_verified: "true" });
    await expectRefusedWithoutSideEffects(await call());
  });
});

describe("already linked", () => {
  it("matching UID: normal sign-in, unchanged — verification isn't re-checked", async () => {
    h.employee = employee("fb-new");
    h.decoded = token({ email_verified: false });
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([]); // nothing to link, marker or join stamp
    expect(h.sessionRows).toHaveLength(1);
    expect(h.cookiesMinted).toBe(1);
  });

  it("matching UID still clears the admin-reset marker and stamps the first join, as before", async () => {
    h.employee = employee("fb-new", { passwordResetByAdminAt: new Date(), joinedAt: null });
    h.decoded = token({ email_verified: false });
    expect((await call()).status).toBe(200);
    expect(h.updates).toEqual([{ passwordResetByAdminAt: null, joinedAt: expect.any(Date) }]);
  });
});

describe("re-linking a different UID", () => {
  it("verified email: follows the existing flow (UID replaced)", async () => {
    h.employee = employee("fb-old");
    h.decoded = token({ email_verified: true });
    expect((await call()).status).toBe(200);
    expect(h.updates).toEqual([{ firebaseUid: "fb-new" }]);
    expect(h.cookiesMinted).toBe(1);
  });

  it("unverified email: refused — the stored UID is not replaced, and no other field changes either", async () => {
    h.employee = employee("fb-old", { passwordResetByAdminAt: new Date(), joinedAt: null });
    h.decoded = token({ email_verified: false });
    await expectRefusedWithoutSideEffects(await call());
  });

  it("an admin or super-admin row is protected the same way", async () => {
    h.employee = employee("fb-owner", { isAdmin: true, email: "owner@example.test" });
    h.decoded = token({ uid: "fb-attacker", email: "owner@example.test", email_verified: false });
    await expectRefusedWithoutSideEffects(await call());
  });
});

describe("the decision comes only from the verified token", () => {
  it("request-body fields claiming verification, an employee id or a role are ignored", async () => {
    h.employee = employee(null);
    h.decoded = token({ email_verified: false });
    await expectRefusedWithoutSideEffects(await call({ idToken: "header.payload.signature", email_verified: true, employeeId: EMPLOYEE, role: "admin", isAdmin: true }));
  });

  it("the refusal log names neither the token nor the email", async () => {
    h.employee = employee(null);
    h.decoded = token({ email_verified: false });
    await call();
    const logged = JSON.stringify((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toMatch(/header\.payload\.signature|person@example\.test/);
  });

  it("unchanged: an invalid token, a token without email, or an unknown/inactive email is still refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call()).status).toBe(401); // verifyIdToken fails
    h.decoded = { uid: "fb-new", email_verified: true };
    expect((await call()).status).toBe(400);
    h.decoded = token({ email_verified: true });
    expect((await call()).status).toBe(403); // no employee
    h.employee = employee(null, { isActive: false });
    expect((await call()).status).toBe(403);
    expect(h.updates).toEqual([]);
    expect(h.cookiesMinted).toBe(0);
  });
});
