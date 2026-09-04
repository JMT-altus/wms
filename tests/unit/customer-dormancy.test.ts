import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STATUS_FILTER_DEFAULT,
  STATUS_FILTER_OPTIONS,
  customerCountLabel,
  isDormant,
  matchesStatusFilter,
  statusLabel,
  type DormancyRow,
} from "@/lib/masters/dormancy";

/**
 * Dormancy has two halves worth pinning down, and they fail differently.
 *
 * The RULE (lib/masters/dormancy.ts) decides which customers a list shows.
 * Both the Client Master and the Customer Master read it, so a bug here means
 * a customer parked on one screen still trading on the other.
 *
 * The WRITE (lib/masters/dormancy-store.ts) decides which ids get stamped. A
 * bug there is the wrong customers disappearing from every list at once, so
 * what is tested is everything it settles BEFORE the UPDATE. The db is a mock:
 * a real one would make this an integration test of drizzle, not of the rule.
 */

const row = (over: Partial<DormancyRow> = {}): DormancyRow => ({
  isActive: true,
  dormantAt: null,
  ...over,
});

const PARKED = row({ dormantAt: "2026-09-03T10:00:00.000Z" });
const ACTIVE = row();
const INACTIVE = row({ isActive: false });
/** Dormant AND inactive — the case where the two flags could contradict. */
const PARKED_INACTIVE = row({ isActive: false, dormantAt: "2026-09-03T10:00:00.000Z" });

describe("the dormancy rule", () => {
  it("starts on a value, not on All — that is what hides a parked customer", () => {
    expect(STATUS_FILTER_DEFAULT).toBe("current");
    expect(STATUS_FILTER_OPTIONS.map((o) => o.value)).toContain(STATUS_FILTER_DEFAULT);
  });

  it("hides dormant customers at the default", () => {
    expect(matchesStatusFilter(ACTIVE, STATUS_FILTER_DEFAULT)).toBe(true);
    expect(matchesStatusFilter(INACTIVE, STATUS_FILTER_DEFAULT)).toBe(true);
    expect(matchesStatusFilter(PARKED, STATUS_FILTER_DEFAULT)).toBe(false);
    expect(matchesStatusFilter(PARKED_INACTIVE, STATUS_FILTER_DEFAULT)).toBe(false);
  });

  it("shows only dormant customers on Dormant — the way back", () => {
    expect(matchesStatusFilter(PARKED, "dormant")).toBe(true);
    expect(matchesStatusFilter(PARKED_INACTIVE, "dormant")).toBe(true);
    expect(matchesStatusFilter(ACTIVE, "dormant")).toBe(false);
    expect(matchesStatusFilter(INACTIVE, "dormant")).toBe(false);
  });

  it("keeps dormant out of Active and Inactive — they describe the register", () => {
    expect(matchesStatusFilter(ACTIVE, "active")).toBe(true);
    expect(matchesStatusFilter(PARKED, "active")).toBe(false);
    expect(matchesStatusFilter(INACTIVE, "inactive")).toBe(true);
    // Parked and inactive: still not in Inactive, because parked outranks it.
    expect(matchesStatusFilter(PARKED_INACTIVE, "inactive")).toBe(false);
  });

  it("shows everything only when the chip is cleared to All", () => {
    for (const r of [ACTIVE, INACTIVE, PARKED, PARKED_INACTIVE]) {
      expect(matchesStatusFilter(r, "")).toBe(true);
    }
  });

  it("says Dormant rather than Active for a parked customer", () => {
    // The cell, the search and the CSV all read this — a parked customer
    // showing as "Active" would contradict the filter that surfaced it.
    expect(statusLabel(PARKED)).toBe("Dormant");
    expect(statusLabel(PARKED_INACTIVE)).toBe("Dormant");
    expect(statusLabel(ACTIVE)).toBe("Active");
    expect(statusLabel(INACTIVE)).toBe("Inactive");
  });

  it("reads dormancy off the timestamp, not off Active", () => {
    expect(isDormant(PARKED)).toBe(true);
    expect(isDormant(INACTIVE)).toBe(false);
  });
});

describe("customerCountLabel", () => {
  it("singularises one", () => {
    expect(customerCountLabel(1)).toBe("1 customer");
    expect(customerCountLabel(0)).toBe("0 customers");
    expect(customerCountLabel(12)).toBe("12 customers");
  });
});

/* ── The write ───────────────────────────────────────────────────────────── */

const { updateMock, setMock, whereMock, returningMock, inArrayMock } = vi.hoisted(() => {
  const returningMock = vi.fn();
  const whereMock = vi.fn(() => ({ returning: returningMock }));
  const setMock = vi.fn(() => ({ where: whereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  const inArrayMock = vi.fn((_col: unknown, ids: string[]) => ({ __in: ids }));
  return { updateMock, setMock, whereMock, returningMock, inArrayMock };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { update: updateMock } }));
vi.mock("@/db/schema", () => ({ customerMasters: { id: "customer_masters.id" } }));
vi.mock("drizzle-orm", () => ({ inArray: inArrayMock }));

const { setCustomerDormancy } = await import("@/lib/masters/dormancy-store");

const ID = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

/** The ids the UPDATE was actually scoped to. */
function idsWritten(): string[] {
  const calls = whereMock.mock.calls as unknown as [{ __in?: string[] }][];
  return calls[0]?.[0]?.__in ?? [];
}

/** The column values the UPDATE set. */
function valuesWritten(): { dormantAt: Date | null } {
  const calls = setMock.mock.calls as unknown as [{ dormantAt: Date | null }][];
  return calls[0]![0];
}

beforeEach(() => {
  updateMock.mockClear();
  setMock.mockClear();
  whereMock.mockClear();
  returningMock.mockReset();
  inArrayMock.mockClear();
  returningMock.mockResolvedValue([{ id: ID(1) }]);
});

describe("setCustomerDormancy", () => {
  it("stamps a time when parking, and clears it when reactivating", async () => {
    await setCustomerDormancy([ID(1)], true);
    expect(valuesWritten().dormantAt).toBeInstanceOf(Date);

    setMock.mockClear();
    await setCustomerDormancy([ID(1)], false);
    expect(valuesWritten().dormantAt).toBeNull();
  });

  it("reports how many rows it touched, not how many ids it was handed", async () => {
    // An id that no longer exists must not be counted as parked.
    returningMock.mockResolvedValue([{ id: ID(1) }]);
    expect(await setCustomerDormancy([ID(1), ID(2)], true)).toEqual({ ok: true, count: 1 });
  });

  it("drops anything that is not a uuid rather than writing on a guess", async () => {
    await setCustomerDormancy([ID(1), "", "not-an-id", null, 7, ID(2)], true);
    expect(idsWritten()).toEqual([ID(1), ID(2)]);
  });

  it("writes each id once, however many times it was selected", async () => {
    await setCustomerDormancy([ID(1), ID(1), ID(2)], true);
    expect(idsWritten()).toEqual([ID(1), ID(2)]);
  });

  it("refuses a selection with nothing usable in it, without touching the db", async () => {
    for (const bad of [[], ["nope"], null, "abc", undefined]) {
      expect(await setCustomerDormancy(bad, true)).toEqual({
        ok: false,
        error: "Nothing selected.",
      });
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses more than the 500-row ceiling", async () => {
    const many = Array.from(
      { length: 501 },
      (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    const res = await setCustomerDormancy(many, true);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/501 customers/);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns the failure rather than throwing, so the button can show it", async () => {
    returningMock.mockRejectedValue(new Error("connection lost"));
    expect(await setCustomerDormancy([ID(1)], true)).toEqual({
      ok: false,
      error: "Could not save: connection lost",
    });
  });
});
