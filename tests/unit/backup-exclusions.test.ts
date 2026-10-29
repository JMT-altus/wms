import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The general (Google Sheets) backup must never copy owner-only commitments.
// Database MOCKED: we only check which tables the export would read.
const h = vi.hoisted(() => ({ queries: [] as string[], tables: [] as string[] }));
vi.mock("@/lib/db", () => ({
  db: {
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q);
      h.queries.push(text);
      if (text.includes("information_schema.tables")) return h.tables.map((table_name) => ({ table_name }));
      return [];
    },
  },
}));

import { BACKUP_EXCLUDED_TABLES, countRows, dumpTable, isBackupExcluded, listBackupTables } from "@/lib/backup/export";

beforeEach(() => {
  h.queries = [];
  h.tables = ["attendance_logs", "collection_amount_confirmations", "collection_commitments", "collection_escalations", "collection_master_companies", "employees"];
});

describe("general backup exclusions", () => {
  it("lists collection_commitments and collection_escalations as excluded, explicitly", () => {
    expect(BACKUP_EXCLUDED_TABLES).toEqual(["collection_commitments", "collection_escalations"]);
    expect(isBackupExcluded("collection_escalations")).toBe(true);
    expect(isBackupExcluded("collection_amount_confirmations")).toBe(false); // visible to every Tracker user
    expect(isBackupExcluded("collection_commitments")).toBe(true);
    expect(isBackupExcluded(" Collection_Commitments ")).toBe(true);
    expect(isBackupExcluded("collection_master_companies")).toBe(false);
  });

  it("the table listing leaves it out and keeps every other table", async () => {
    expect(await listBackupTables()).toEqual(["attendance_logs", "collection_amount_confirmations", "collection_master_companies", "employees"]);
  });

  it("dumping or counting it by name is refused before any query runs", async () => {
    await expect(dumpTable("collection_commitments")).rejects.toThrow(/excluded from the general backup/);
    await expect(countRows("collection_commitments")).rejects.toThrow(/excluded from the general backup/);
    await expect(dumpTable("collection_escalations")).rejects.toThrow(/excluded from the general backup/);
    expect(h.queries).toEqual([]);
  });

  it("other tables still dump as before", async () => {
    await expect(dumpTable("employees")).resolves.toMatchObject({ table: "employees" });
  });

  it("the Sheets backup takes its tables only from listBackupTables (no second path)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/backup/sheets.ts"), "utf8");
    expect(src).toMatch(/const tables = await listBackupTables\(\)/);
    expect(src).not.toMatch(/collection_commitments|information_schema/);
    for (const f of ["lib/backup/run.ts", "lib/backup/drive.ts"]) {
      expect(readFileSync(resolve(__dirname, "../..", f), "utf8")).not.toMatch(/collection_commitments|dumpTable|information_schema\.tables/);
    }
  });
});

describe("balance snapshots stay in the general backup", () => {
  // Decision (reviewed): Debit / Credit per company is what every Tracker user already sees, unlike the
  // owner-only commitments and the escalation queue, so these tables are NOT excluded.
  it("the two balance tables are listed for backup and can be dumped", async () => {
    h.tables = ["collection_balance_lines", "collection_balance_snapshots", "collection_commitments", "collection_escalations", "employees"];
    expect(await listBackupTables()).toEqual(["collection_balance_lines", "collection_balance_snapshots", "employees"]);
    expect(isBackupExcluded("collection_balance_snapshots")).toBe(false);
    expect(isBackupExcluded("collection_balance_lines")).toBe(false);
    expect(BACKUP_EXCLUDED_TABLES).toEqual(["collection_commitments", "collection_escalations"]);
    await expect(countRows("collection_balance_lines")).resolves.not.toThrow();
  });
});
