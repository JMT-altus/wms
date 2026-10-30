import { describe, it, expect, vi, beforeEach } from "vitest";

const createUser = vi.fn();
const setCustomUserClaims = vi.fn().mockResolvedValue(undefined);
const generatePasswordResetLink = vi.fn().mockResolvedValue("https://x/reset");
const deleteUser = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/firebase/admin", () => ({
  getFirebaseAdminAuth: () => ({
    createUser,
    setCustomUserClaims,
    generatePasswordResetLink,
    deleteUser,
  }),
}));

const sendCredentialsEmail = vi.fn().mockResolvedValue({ id: "e1", error: null });
const inserted = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
const sendInviteEmail = vi.fn().mockResolvedValue({ id: "e2", error: null });
vi.mock("@/lib/email/resend", () => ({ sendCredentialsEmail, sendInviteEmail }));

vi.mock("@/lib/auth/current", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", name: "Admin User" }),
}));

// inviteEmployee: dup-check via findFirst (return undefined = no dup), then
// insert(...).returning() yields the new row. Department helpers also call db;
// resolveDepartmentSelection issues a select on departments — return [] so it
// resolves to no departments. writeMemberships inserts; make insert chainable
// for both .returning() and plain awaits.
vi.mock("@/lib/db", () => {
  const insertBuilder = {
    values: (v: unknown) => ({
      ...(inserted(v), {}),
      returning: () =>
        Promise.resolve([
          {
            id: "00000000-0000-4000-8000-000000000000",
            name: "Dev User",
            email: "dev@altus.test",
            role: "doer",
            department: null,
            isAdmin: false,
          },
        ]),
      onConflictDoNothing: () => Promise.resolve(),
    }),
  };
  return {
    db: {
      query: { employees: { findFirst: (...a: unknown[]) => findFirst(...a) } },
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => insertBuilder,
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/cache-tags", () => ({ CACHE_TAGS: { employees: "employees" } }));

beforeEach(() => {
  createUser.mockReset().mockResolvedValue({ uid: "fb-uid-1" });
  setCustomUserClaims.mockClear();
  generatePasswordResetLink.mockClear();
  sendCredentialsEmail.mockClear();
  sendInviteEmail.mockClear();
  inserted.mockClear();
  findFirst.mockReset().mockResolvedValue(undefined);
});

describe("inviteEmployee (credentials flow)", () => {
  it("creates the Firebase user WITH the default password and emailVerified, and emails credentials", async () => {
    const { inviteEmployee } = await import("@/app/(admin)/admin/employees/actions");
    const res = await inviteEmployee({
      name: "Dev User",
      email: "dev@altus.test",
      role: "doer",
      departmentIds: [],
      primaryDepartmentId: null,
      isAdmin: false,
    });
    expect(res.ok).toBe(true);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "dev@altus.test",
        password: "Wms@123",
        emailVerified: true,
      }),
    );
    expect(sendCredentialsEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "dev@altus.test", password: "Wms@123" }),
    );
    expect(generatePasswordResetLink).not.toHaveBeenCalled();
  });
});

describe("invite email delivery", () => {
  const input = { name: "Dev User", email: "dev@altus.test", role: "doer" as const, departmentIds: [], primaryDepartmentId: null, isAdmin: false };
  const events = () => inserted.mock.calls.map((c) => c[0] as { eventType?: string; note?: string }).filter((v) => v.eventType);

  it("when the email fails the account is kept, the warning says so, and the failure is audited without the password", async () => {
    sendCredentialsEmail.mockResolvedValueOnce({ id: null, error: "Resend is in testing mode — the sender domain isn't verified." });
    const { inviteEmployee } = await import("@/app/(admin)/admin/employees/actions");
    const res = await inviteEmployee(input);
    expect(res.ok).toBe(true);
    expect(res.id).toBeTruthy();
    expect(res.warning).toMatch(/login-details email failed: Resend is in testing mode.*Use "Resend invite" to retry/);
    expect(deleteUser).not.toHaveBeenCalled();
    const failed = events().find((e) => e.eventType === "invite_email_failed");
    expect(failed?.note).toMatch(/testing mode/);
    expect(JSON.stringify(inserted.mock.calls)).not.toMatch(/Wms@123/);
    expect(events().some((e) => e.eventType === "invited")).toBe(true);
  });

  it("Resend invite re-sends to the EXISTING employee: no Firebase user, no employee row, one audit row", async () => {
    findFirst.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000000", name: "Dev User", email: "dev@altus.test", joinedAt: null, firebaseUid: "fb-uid-1", isActive: true });
    const { resendInvite } = await import("@/app/(admin)/admin/employees/actions");
    const res = await resendInvite("00000000-0000-4000-8000-000000000000");
    expect(res).toEqual({ ok: true });
    expect(createUser).not.toHaveBeenCalled();
    expect(sendCredentialsEmail).toHaveBeenCalledWith(expect.objectContaining({ email: "dev@altus.test", inviteeName: "Dev User" }));
    expect(events().map((e) => e.eventType)).toEqual(["invite_resent"]);
  });

  it("a failed retry reports the provider's message and audits it; an employee who already joined is not re-invited", async () => {
    findFirst.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000000", name: "Dev User", email: "dev@altus.test", joinedAt: null, firebaseUid: "fb-uid-1", isActive: true });
    sendCredentialsEmail.mockResolvedValueOnce({ id: null, error: "API key is invalid" });
    const { resendInvite } = await import("@/app/(admin)/admin/employees/actions");
    expect(await resendInvite("00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "API key is invalid" });
    expect(events().map((e) => [e.eventType, e.note])).toEqual([["invite_email_failed", "API key is invalid"]]);
    expect(createUser).not.toHaveBeenCalled();

    findFirst.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000000", name: "Dev User", email: "dev@altus.test", joinedAt: new Date(), firebaseUid: "fb-uid-1", isActive: true });
    expect(await resendInvite("00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "Employee has already joined." });
    expect(sendCredentialsEmail).toHaveBeenCalledTimes(1);
  });
});
