import { beforeEach, describe, expect, it, vi } from "vitest";

// Super-admin account protection in the employee-management server actions,
// called DIRECTLY (no UI): an ordinary admin can't reset a super-admin's
// password, obtain a reset/invite link for one, re-send its invite, delete it,
// or invite a reserved super-admin address. Super-admins keep these workflows.
//
// MOCKED: session (requireAdmin), Firebase Admin, email, database. Super-admin
// status is mocked to two made-up addresses standing in for SUPER_ADMIN_EMAILS
// (same trim + lower-case comparison), so no real account appears here.
const h = vi.hoisted(() => ({
  me: { id: "admin-1", name: "Asha", email: "asha@example.test" } as { id: string; name: string; email: string },
  /** The stored employee row the action loads by id. */
  target: null as null | Record<string, unknown>,
  events: [] as Record<string, unknown>[],
  auditFails: false,
  dbWrites: [] as string[],
}));
const fb = vi.hoisted(() => ({
  createUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  generatePasswordResetLink: vi.fn(),
  updateUser: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  deleteUser: vi.fn(),
}));
const mail = vi.hoisted(() => ({
  sendCredentialsEmail: vi.fn(),
  sendInviteEmail: vi.fn(),
  sendPasswordChangedByAdminEmail: vi.fn(),
}));

vi.mock("@/lib/auth/super-admin", () => ({
  isSuperAdmin: (e: string | null | undefined) => ["root@example.test", "root2@example.test"].includes((e ?? "").trim().toLowerCase()),
}));
vi.mock("@/lib/auth/current", () => ({ requireAdmin: async () => h.me }));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminAuth: () => fb }));
vi.mock("@/lib/email/resend", () => mail);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/cache-tags", () => ({ CACHE_TAGS: { employees: "employees" } }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://wms.example.test" }));
vi.mock("@/lib/db", () => {
  const insertValues = (v: Record<string, unknown>) => {
    h.dbWrites.push("insert");
    if ("eventType" in v) {
      if (h.auditFails) return Promise.reject(new Error("audit down"));
      h.events.push(v);
    }
    const p = Promise.resolve();
    return Object.assign(p, {
      returning: () => Promise.resolve([{ id: "00000000-0000-4000-8000-0000000000aa", name: "New", email: "new@example.test", role: "doer", department: null, isAdmin: false }]),
      onConflictDoNothing: () => Promise.resolve(),
    });
  };
  return {
    db: {
      query: { employees: { findFirst: vi.fn(async () => h.target ?? undefined) } },
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({ values: insertValues }),
      update: () => ({
        set: () => ({
          where: () => {
            h.dbWrites.push("update");
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({
        where: () => {
          h.dbWrites.push("delete");
          return Promise.resolve();
        },
      }),
      transaction: vi.fn(async () => {
        h.dbWrites.push("transaction");
        throw new Error("not exercised here");
      }),
    },
  };
});

import { deleteEmployee, getInviteLink, inviteEmployee, resendInvite, resetEmployeePassword } from "@/app/(admin)/admin/employees/actions";

const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const row = (id: string, email: string, over: Record<string, unknown> = {}) => ({
  id,
  email,
  name: "Someone",
  isActive: true,
  firebaseUid: `fb-${id}`,
  joinedAt: null,
  ...over,
});
/** The stored super-admin row — written in another case and with spaces, as old data may be. */
const superTarget = () => row(ROOT_ID, " Root@Example.test ");
const staffTarget = () => row(STAFF_ID, "staff@example.test");
const asAdmin = () => {
  h.me = { id: "admin-1", name: "Asha", email: "asha@example.test" };
};
const asSuper = () => {
  h.me = { id: "super-2", name: "Sam", email: "root2@example.test" };
};
const REFUSED = "Only a super-admin can do this for a super-admin account.";
const noSideEffects = () => {
  for (const f of Object.values(fb)) expect(f).not.toHaveBeenCalled();
  for (const f of Object.values(mail)) expect(f).not.toHaveBeenCalled();
  expect(h.dbWrites).toEqual([]);
  expect(h.events).toEqual([]);
};

beforeEach(() => {
  asAdmin();
  h.target = null;
  h.events = [];
  h.auditFails = false;
  h.dbWrites = [];
  for (const f of Object.values(fb)) f.mockReset();
  for (const f of Object.values(mail)) f.mockReset();
  fb.createUser.mockResolvedValue({ uid: "fb-new" });
  fb.setCustomUserClaims.mockResolvedValue(undefined);
  fb.generatePasswordResetLink.mockResolvedValue("https://auth.example.test/reset?oobCode=SECRET-CODE");
  fb.updateUser.mockResolvedValue(undefined);
  fb.revokeRefreshTokens.mockResolvedValue(undefined);
  mail.sendCredentialsEmail.mockResolvedValue({ id: "m1", error: null });
  mail.sendPasswordChangedByAdminEmail.mockResolvedValue({ id: "m2", error: null });
});

describe("resetEmployeePassword", () => {
  it("an ordinary admin can't reset a super-admin's password — refused before Firebase, the database or email", async () => {
    h.target = superTarget();
    expect(await resetEmployeePassword(ROOT_ID, "a-long-new-password-1")).toEqual({ ok: false, error: REFUSED });
    noSideEffects();
  });

  it("a super-admin can, and it's audited as before", async () => {
    asSuper();
    h.target = superTarget();
    expect((await resetEmployeePassword(ROOT_ID, "a-long-new-password-1")).ok).toBe(true);
    expect(fb.updateUser).toHaveBeenCalledWith(`fb-${ROOT_ID}`, { password: "a-long-new-password-1" });
    expect(h.events).toEqual([expect.objectContaining({ employeeId: ROOT_ID, actorId: "super-2", eventType: "password_reset_by_admin" })]);
    expect(JSON.stringify(h.events)).not.toMatch(/a-long-new-password-1/);
  });

  it("an ordinary admin still resets an ordinary employee's password (existing workflow)", async () => {
    h.target = staffTarget();
    expect((await resetEmployeePassword(STAFF_ID, "a-long-new-password-1")).ok).toBe(true);
    expect(fb.updateUser).toHaveBeenCalled();
  });
});

describe("getInviteLink", () => {
  it("an ordinary admin can't obtain a reset/invite link for a super-admin — no link is even generated", async () => {
    h.target = superTarget();
    expect(await getInviteLink(ROOT_ID)).toEqual({ ok: false, error: REFUSED });
    noSideEffects();
  });

  it("a super-admin gets the link; the generation is audited without the link or its code", async () => {
    asSuper();
    h.target = superTarget();
    const res = await getInviteLink(ROOT_ID);
    expect(res).toEqual({ ok: true, link: "https://auth.example.test/reset?oobCode=SECRET-CODE" });
    expect(h.events).toEqual([{ employeeId: ROOT_ID, actorId: "super-2", eventType: "invite_link_generated" }]);
    expect(JSON.stringify(h.events)).not.toMatch(/SECRET-CODE|https:/);
  });

  it("an ordinary admin still gets a link for an ordinary employee — audited", async () => {
    h.target = staffTarget();
    expect((await getInviteLink(STAFF_ID)).ok).toBe(true);
    expect(h.events).toEqual([{ employeeId: STAFF_ID, actorId: "admin-1", eventType: "invite_link_generated" }]);
  });

  it("if the audit can't be written, the link is NOT returned", async () => {
    h.target = staffTarget();
    h.auditFails = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await getInviteLink(STAFF_ID);
    expect(res).toEqual({ ok: false, error: "The link couldn't be recorded, so it wasn't issued. Please try again." });
    expect(JSON.stringify(res)).not.toMatch(/SECRET-CODE/);
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/SECRET-CODE/);
    err.mockRestore();
  });
});

describe("resendInvite", () => {
  it("an ordinary admin can't re-send a super-admin's invite (it carries the initial password)", async () => {
    h.target = superTarget();
    expect(await resendInvite(ROOT_ID)).toEqual({ ok: false, error: REFUSED });
    noSideEffects();
  });

  it("a super-admin can; an ordinary admin can for an ordinary employee", async () => {
    asSuper();
    h.target = superTarget();
    expect(await resendInvite(ROOT_ID)).toEqual({ ok: true });
    asAdmin();
    h.target = staffTarget();
    expect(await resendInvite(STAFF_ID)).toEqual({ ok: true });
    expect(mail.sendCredentialsEmail).toHaveBeenCalledTimes(2);
  });
});

describe("inviteEmployee", () => {
  const invite = (email: string) => inviteEmployee({ name: "New Person", email, role: "doer", isAdmin: false } as Parameters<typeof inviteEmployee>[0]);

  it("an ordinary admin can't invite a reserved super-admin address (any case) — no lookup, account or row is created", async () => {
    for (const email of ["root@example.test", "ROOT2@EXAMPLE.TEST"]) {
      expect(await invite(email)).toEqual({ ok: false, error: "This address belongs to a super-admin account. Only a super-admin can invite it." });
    }
    noSideEffects();
  });

  it("a super-admin can invite a reserved address; an ordinary admin can invite anyone else", async () => {
    asSuper();
    expect((await invite("root@example.test")).ok).toBe(true);
    expect(fb.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "root@example.test" }));
    asAdmin();
    fb.createUser.mockClear();
    expect((await invite("someone.new@example.test")).ok).toBe(true);
    expect(fb.createUser).toHaveBeenCalledTimes(1);
  });
});

describe("deleteEmployee", () => {
  it("an ordinary admin can't delete a super-admin — refused before the confirmation check or any write", async () => {
    h.target = superTarget();
    expect(await deleteEmployee(ROOT_ID, "root@example.test")).toEqual({ ok: false, error: REFUSED });
    noSideEffects();
  });

  it("a super-admin passes the guard (and still faces the existing confirmation check)", async () => {
    asSuper();
    h.target = superTarget();
    expect(await deleteEmployee(ROOT_ID, "wrong@example.test")).toEqual({ ok: false, error: "Confirmation email does not match." });
  });

  it("an ordinary admin still reaches the existing checks for an ordinary employee", async () => {
    h.target = staffTarget();
    expect(await deleteEmployee(STAFF_ID, "wrong@example.test")).toEqual({ ok: false, error: "Confirmation email does not match." });
  });
});

describe("trust boundary", () => {
  it("decisions come from the session and the stored row, not from caller input", async () => {
    // The actions take only an id (and a password / confirmation): there is no
    // role or email parameter to forge. A super-admin row is recognised from the
    // database whatever id the caller uses to reach it.
    h.target = superTarget();
    expect((await getInviteLink(ROOT_ID)).ok).toBe(false);
    h.target = { ...superTarget(), id: STAFF_ID };
    expect((await getInviteLink(STAFF_ID)).ok).toBe(false);
    noSideEffects();
  });
});
