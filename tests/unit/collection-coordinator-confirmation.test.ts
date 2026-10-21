import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  autoMap,
  fieldsNeedingConfirmation,
  missingColumnConfirmations,
  readSheet,
  readWorkbook,
  suggestCoordinatorColumn,
} from "@/lib/collections/master/workbook";

// The Sales Coordinator column must be confirmed explicitly — whatever chose it —
// and a named, unrelated column is never suggested. Rules are pure; the server
// actions below run with the database and session MOCKED.
function sheet(aoa: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "S");
  return readSheet(readWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer), "S");
}
const people = ["Mihir", "Gauri", "MANGESH", "Jyotsna"];

describe("which column is suggested", () => {
  it("a named non-coordinator column (City, Zone) is never suggested, however name-like its values", () => {
    for (const header of ["City", "Zone", "Region"]) {
      const r = sheet([["Name", header, "Payment Terms"], ...Array.from({ length: 40 }, (_, i) => [`Co ${i}`, people[i % 4], ""])]);
      const auto = autoMap(r.columns);
      expect(suggestCoordinatorColumn(r, auto).index, header).toBeNull();
    }
  });

  it("a header that names the coordinator is matched, but still needs confirmation", () => {
    const r = sheet([["Name", "Sales Coordinator"], ["A Co", "Mihir"], ["B Co", "Gauri"]]);
    const auto = autoMap(r.columns);
    expect(auto.coordinator).toBe(1);
    expect(fieldsNeedingConfirmation(r.columns, auto)).toEqual(["coordinator"]);
  });

  it("an unnamed column is suggested and needs confirmation; two candidates mean no suggestion", () => {
    const one = sheet([["Name", null, "Payment Terms"], ...Array.from({ length: 40 }, (_, i) => [`Co ${i}`, people[i % 4], ""])]);
    const auto = autoMap(one.columns);
    const pick = suggestCoordinatorColumn(one, auto);
    expect(pick.index).toBe(1);
    expect(fieldsNeedingConfirmation(one.columns, { ...auto, coordinator: pick.index })).toEqual(["coordinator"]);
    const two = sheet([["Name", null, null], ...Array.from({ length: 40 }, (_, i) => [`Co ${i}`, people[i % 4], people[(i + 1) % 4]])]);
    expect(suggestCoordinatorColumn(two, autoMap(two.columns)).index).toBeNull();
  });

  it("other unnamed fields still need confirmation; named company/terms columns don't", () => {
    const r = sheet([["Name", "Payment Terms", null], ["A", "30 days", "x"]]);
    expect(fieldsNeedingConfirmation(r.columns, { company: 0, coordinator: null, paymentTerms: 1 })).toEqual([]);
    expect(fieldsNeedingConfirmation(r.columns, { company: 2, coordinator: null, paymentTerms: 1 })).toEqual(["company"]);
  });
});

describe("server-side rule", () => {
  it("names exactly what is missing", () => {
    const m = { company: "A · Name", coordinator: "Unnamed column B", paymentTerms: "Unnamed column D" };
    expect(missingColumnConfirmations(m, {})).toEqual(["coordinator", "paymentTerms"]);
    expect(missingColumnConfirmations(m, { coordinator: true })).toEqual(["paymentTerms"]);
    expect(missingColumnConfirmations(m, { coordinator: true, paymentTerms: true })).toEqual([]);
    expect(missingColumnConfirmations({ company: "A · Name", coordinator: "B · Sales Coordinator", paymentTerms: null }, {})).toEqual(["coordinator"]);
    expect(missingColumnConfirmations({ company: "A · Name", coordinator: null, paymentTerms: null }, {})).toEqual([]);
  });
});

// ── the actions ───────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({ transactions: 0, reads: 0, imports: [] as Record<string, unknown>[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/current", () => ({
  requireAdmin: async () => ({ id: "admin-1", isAdmin: true, isActive: true }),
  getCurrentEmployee: async () => ({ id: "admin-1", isAdmin: true, isActive: true }),
}));
vi.mock("@/lib/auth/field-access", () => ({
  getMyFieldAccess: async () => Object.fromEntries(["collection.master.import"].map((k) => [k, { allowed: true, source: "admin" }])),
}));
vi.mock("@/lib/queries/collection-master", () => ({
  isMissingTable: () => false,
  loadExistingByKeys: async () => {
    h.reads++;
    return new Map();
  },
  loadClientMasterIndex: async () => new Map(),
  listKnownCoordinatorLabels: async () => [],
}));
vi.mock("@/lib/db", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.transactions++;
      const chain = (): unknown => {
        const c: Record<string, unknown> = {};
        c.from = () => c;
        c.where = () => c;
        c.for = async () => [];
        return c;
      };
      const tx = {
        select: () => chain(),
        insert: (table: Record<string, unknown>) => ({
          values: (v: Record<string, unknown>) => {
            const ch = {
              onConflictDoNothing: () => ch,
              returning: async () => {
                if ("columnMapping" in table) {
                  h.imports.push(v);
                  return [{ id: "import-1" }];
                }
                return [{ id: "new" }];
              },
            };
            return ch;
          },
        }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      };
      return fn(tx);
    },
  },
}));

import { importCollectionMaster, previewCollectionMaster } from "@/app/(forms-module)/forms/collection/master/actions";

const body = (over: Record<string, unknown> = {}) => ({
  fileName: "MasterFile.xlsx",
  mapping: { company: "A · Name", coordinator: "Unnamed column B", paymentTerms: null },
  rows: [{ rowNo: 2, company: "Alpha Traders", coordinator: "Mihir", paymentTerms: "" }],
  ...over,
});

beforeEach(() => {
  h.transactions = 0;
  h.reads = 0;
  h.imports = [];
});

describe("server enforcement", () => {
  it("preview and import refuse an unconfirmed coordinator column — called directly, without the UI", async () => {
    const pv = await previewCollectionMaster(body());
    expect(pv).toEqual({ ok: false, error: "Confirm which column holds the Sales Coordinator before previewing or importing." });
    const im = await importCollectionMaster({ ...body(), confirm: true });
    expect(im.ok).toBe(false);
    expect(h.reads).toBe(0);
    expect(h.transactions).toBe(0);
  });

  it("a header-matched coordinator column still needs the confirmation", async () => {
    const res = await importCollectionMaster({ ...body({ mapping: { company: "A · Name", coordinator: "B · Sales Coordinator", paymentTerms: null } }), confirm: true });
    expect(res.ok).toBe(false);
    expect(h.transactions).toBe(0);
  });

  it("refuses a bogus confirmation value", async () => {
    const res = await previewCollectionMaster(body({ confirmedColumns: { coordinator: "yes" } }));
    expect(res.ok).toBe(false);
  });

  it("with the confirmation, preview and import proceed and the audit row records it", async () => {
    expect((await previewCollectionMaster(body({ confirmedColumns: { coordinator: true } }))).ok).toBe(true);
    const res = await importCollectionMaster({ ...body({ confirmedColumns: { coordinator: true } }), confirm: true });
    expect(res.ok).toBe(true);
    expect(h.imports[0]).toMatchObject({ columnMapping: { coordinator: "Unnamed column B", confirmed: { coordinator: true } } });
  });

  it("no coordinator mapped → nothing to confirm (company-only import still works)", async () => {
    const res = await previewCollectionMaster(body({ mapping: { company: "A · Name", coordinator: null, paymentTerms: null } }));
    expect(res.ok).toBe(true);
  });
});
