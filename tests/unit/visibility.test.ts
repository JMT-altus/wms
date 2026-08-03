import { describe, it, expect } from "vitest";
import {
  canSee,
  isEmptyRestricted,
  matchesAudience,
  type Subject,
  type Viewer,
} from "@/lib/access/visibility";

const SALES = "11111111-1111-1111-1111-111111111111";
const SUPPORT = "22222222-2222-2222-2222-222222222222";

const staff = (over: Partial<Viewer> = {}): Viewer => ({
  id: "emp-staff",
  isSuperAdmin: false,
  isManagement: false,
  departmentIds: [SALES],
  ...over,
});

const subject = (over: Partial<Subject> = {}): Subject => ({
  visibility: "internal",
  participantIds: [],
  audience: [],
  ...over,
});

describe("canSee — internal (the pre-existing behaviour)", () => {
  it("is visible to everyone", () => {
    expect(canSee(staff(), subject({ visibility: "internal" }))).toBe(true);
  });
});

describe("canSee — private", () => {
  it("hides the row from an uninvolved colleague", () => {
    expect(canSee(staff(), subject({ visibility: "private" }))).toBe(false);
  });

  it("shows it to anyone ON the row", () => {
    const me = staff();
    for (const participants of [[me.id], [null, me.id], [null, null, me.id]]) {
      expect(
        canSee(me, { visibility: "private", participantIds: participants }),
      ).toBe(true);
    }
  });

  it("shows it to a super-admin — that is Mihir Veera and Altus Corp", () => {
    expect(
      canSee(staff({ isSuperAdmin: true }), subject({ visibility: "private" })),
    ).toBe(true);
  });

  it("does NOT leak to an ordinary admin", () => {
    // `is_admin` is deliberately absent from Viewer: only the two super-admin
    // accounts pierce the personal space. If this ever starts passing, the
    // personal space has quietly become a shared one.
    const ordinaryAdmin = staff({ id: "emp-admin" });
    expect(canSee(ordinaryAdmin, subject({ visibility: "private" }))).toBe(false);
  });

  it("ignores null participants rather than matching them", () => {
    // An unassigned pool task has doerId === null. A viewer whose id is
    // somehow nullish must not match it.
    expect(
      canSee(staff(), { visibility: "private", participantIds: [null, undefined] }),
    ).toBe(false);
  });
});

describe("canSee — restricted", () => {
  it("opens to a named department", () => {
    expect(
      canSee(
        staff({ departmentIds: [SALES] }),
        subject({
          visibility: "restricted",
          audience: [{ kind: "department", refId: SALES }],
        }),
      ),
    ).toBe(true);
  });

  it("stays closed to a department that was not named", () => {
    expect(
      canSee(
        staff({ departmentIds: [SUPPORT] }),
        subject({
          visibility: "restricted",
          audience: [{ kind: "department", refId: SALES }],
        }),
      ),
    ).toBe(false);
  });

  it("opens to management only for management", () => {
    const audience = [{ kind: "management" as const, refId: null }];
    expect(
      canSee(staff({ isManagement: true }), subject({ visibility: "restricted", audience })),
    ).toBe(true);
    expect(
      canSee(staff({ isManagement: false }), subject({ visibility: "restricted", audience })),
    ).toBe(false);
  });

  it("opens to a named individual", () => {
    expect(
      canSee(
        staff({ id: "emp-x", departmentIds: [] }),
        subject({
          visibility: "restricted",
          audience: [{ kind: "employee", refId: "emp-x" }],
        }),
      ),
    ).toBe(true);
  });

  it("is visible to nobody but participants when the audience is empty", () => {
    expect(canSee(staff(), subject({ visibility: "restricted", audience: [] }))).toBe(false);
    expect(isEmptyRestricted("restricted", [])).toBe(true);
    expect(isEmptyRestricted("private", [])).toBe(false);
  });

  it("matches if ANY audience entry matches", () => {
    expect(
      matchesAudience(staff({ departmentIds: [SUPPORT] }), [
        { kind: "department", refId: SALES },
        { kind: "department", refId: SUPPORT },
      ]),
    ).toBe(true);
  });

  it("does not treat a null department ref as a wildcard", () => {
    expect(
      matchesAudience(staff({ departmentIds: [SALES] }), [
        { kind: "department", refId: null },
      ]),
    ).toBe(false);
  });
});

describe("canSee — participants outrank the setting", () => {
  it("keeps a restricted task visible to its doer even with a foreign audience", () => {
    const me = staff({ id: "doer-1", departmentIds: [] });
    expect(
      canSee(me, {
        visibility: "restricted",
        participantIds: ["doer-1"],
        audience: [{ kind: "department", refId: SALES }],
      }),
    ).toBe(true);
  });
});
