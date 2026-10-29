import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { collectionBalanceLines, collectionBalanceSnapshots } from "@/db/schema";

// Migration 0117 vs the two table definitions in db/schema.ts — compared as TEXT
// against drizzle's own table metadata. No database (not even an in-memory one)
// is created; tests/integration/collection-balances-migration.db.test.ts is the
// real-Postgres (PGlite) counterpart, following the 0115 convention.
const FILE = resolve(__dirname, "../../db/migrations/0117_collection_balances.sql");
const sqlText = readFileSync(FILE, "utf8");
/** The SQL without `--` comments, so prose can't satisfy or break a match. */
const code = sqlText
  .split(/\r?\n/)
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

const TABLES: [string, PgTable][] = [
  ["collection_balance_snapshots", collectionBalanceSnapshots],
  ["collection_balance_lines", collectionBalanceLines],
];

/** The body of `CREATE TABLE IF NOT EXISTS "name" ( … );` split into top-level items. */
function tableItems(name: string): string[] {
  const start = code.indexOf(`CREATE TABLE IF NOT EXISTS "${name}" (`);
  expect(start, `CREATE TABLE for ${name}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let i = code.indexOf("(", start);
  const open = i;
  const items: string[] = [];
  let from = open + 1;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        items.push(code.slice(from, i).trim());
        break;
      }
    } else if (ch === "," && depth === 1) {
      items.push(code.slice(from, i).trim());
      from = i + 1;
    }
  }
  return items.filter(Boolean);
}

/** drizzle's type name → how the migration spells it. */
function sqlType(t: string): string {
  const s = t.toLowerCase().replace(/\s+/g, "");
  if (s === "timestampwithtimezone") return "timestamptz";
  return s; // uuid, text, date, integer, jsonb, numeric(14,2)
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * One index column as Postgres would store it: name, direction AND null ordering,
 * with Postgres' own defaults filled in (ASC → NULLS LAST, DESC → NULLS FIRST), so
 * "DESC" in the SQL and ".desc().nullsFirst()" in drizzle compare equal and a
 * missing or different NULLS clause does not.
 */
function indexColumn(name: string, order: string | undefined, nulls: string | undefined): string {
  const o = (order ?? "asc").toUpperCase();
  const n = (nulls ?? (o === "DESC" ? "first" : "last")).toUpperCase();
  return `${name} ${o} NULLS ${n}`;
}

describe("migration 0117 declares the same tables as db/schema.ts", () => {
  it("creates exactly these two tables and nothing else", () => {
    const created = [...code.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g)].map((m) => m[1]);
    expect(created).toEqual(TABLES.map(([n]) => n));
    expect(getTableConfig(collectionBalanceSnapshots).name).toBe("collection_balance_snapshots");
    expect(getTableConfig(collectionBalanceLines).name).toBe("collection_balance_lines");
  });

  it.each(TABLES)("%s: every column — name, type, nullability, default — matches", (name, table) => {
    const cfg = getTableConfig(table);
    const items = tableItems(name);
    const columnItems = new Map(items.filter((i) => i.startsWith('"')).map((i) => [/^"([a-z_]+)"/.exec(i)![1]!, norm(i)]));
    expect([...columnItems.keys()].sort()).toEqual(cfg.columns.map((c) => c.name).sort());
    for (const c of cfg.columns) {
      const item = columnItems.get(c.name)!;
      const after = item.slice(c.name.length + 2).trim(); // text after the quoted name
      expect(sqlType(after.split(/\s+(NOT NULL|NULL|PRIMARY|DEFAULT|REFERENCES)/i)[0]!), `${name}.${c.name} type`).toBe(sqlType(c.getSQLType()));
      const primary = /PRIMARY KEY/i.test(item);
      expect(primary, `${name}.${c.name} primary key`).toBe(c.primary);
      expect(/NOT NULL/i.test(item) || primary, `${name}.${c.name} NOT NULL`).toBe(c.notNull);
      expect(/\bDEFAULT\b/i.test(item), `${name}.${c.name} has a default`).toBe(c.hasDefault);
    }
  });

  it.each(TABLES)("%s: foreign keys — target and ON DELETE action — match", (name, table) => {
    const cfg = getTableConfig(table);
    const fromSql = tableItems(name)
      .map((i) => /^"([a-z_]+)".*REFERENCES "([a-z_]+)"\("([a-z_]+)"\) ON DELETE ([A-Z ]+)$/i.exec(norm(i)))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => `${m[1]} -> ${m[2]}.${m[3]} ${m[4]!.toUpperCase()}`)
      .sort();
    const fromSchema = cfg.foreignKeys
      .map((fk) => {
        const r = fk.reference();
        return `${r.columns.map((c) => c.name).join(",")} -> ${getTableConfig(r.foreignTable).name}.${r.foreignColumns.map((c) => c.name).join(",")} ${(fk.onDelete ?? "no action").toUpperCase()}`;
      })
      .sort();
    expect(fromSql).toEqual(fromSchema);
  });

  it("indexes: same names, uniqueness, columns, order direction AND null ordering", () => {
    const fromSql = [...code.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS "([a-z_]+)"\s+ON "([a-z_]+)" \(([^)]*)\)/g)]
      .map((m) => ({ name: m[2]!, table: m[3]!, unique: !!m[1], cols: m[4]!.split(",").map((c) => {
          const col = /^"([a-z_]+)"(?:\s+(ASC|DESC))?(?:\s+NULLS\s+(FIRST|LAST))?$/i.exec(norm(c));
          if (!col) throw new Error(`unparseable index column: ${c}`);
          return indexColumn(col[1]!, col[2], col[3]?.toLowerCase());
        }) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const fromSchema = TABLES.flatMap(([, table]) => {
      const cfg = getTableConfig(table);
      return cfg.indexes.map((ix) => ({
        name: ix.config.name ?? "",
        table: cfg.name,
        unique: !!ix.config.unique,
        cols: ix.config.columns.map((c) => {
          const col = c as { name: string; indexConfig?: { order?: string; nulls?: string } };
          return indexColumn(col.name, col.indexConfig?.order, col.indexConfig?.nulls);
        }),
      }));
    }).sort((a, b) => a.name.localeCompare(b.name));
    expect(fromSql).toEqual(fromSchema);
    // Spot-check the two that matter: the one-line-per-company rule, and newest-first.
    expect(fromSql.find((i) => i.name === "collection_balance_lines_snapshot_company_uq")).toMatchObject({ unique: true, cols: ["snapshot_id ASC NULLS LAST", "company_id ASC NULLS LAST"] });
    expect(fromSql.find((i) => i.name === "collection_balance_snapshots_at_idx")?.cols).toEqual(["uploaded_at DESC NULLS FIRST"]);
  });

  it("check constraints: same names, and the same rule in the SQL", () => {
    const fromSql = TABLES.flatMap(([name]) =>
      tableItems(name)
        .map((i) => /^CONSTRAINT "([a-z_]+)"\s+CHECK \((.*)\)$/i.exec(norm(i)))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => ({ name: m[1]!, expr: m[2]! })),
    ).sort((a, b) => a.name.localeCompare(b.name));
    const fromSchema = TABLES.flatMap(([, table]) => getTableConfig(table).checks.map((c) => c.name)).sort();
    expect(fromSql.map((c) => c.name)).toEqual(fromSchema);
    expect(fromSql.map((c) => c.name)).toEqual(["collection_balance_lines_value_check", "collection_balance_snapshots_period_check"]);
    expect(fromSql.find((c) => c.name.endsWith("value_check"))!.expr).toBe('"debit" IS NOT NULL OR "credit" IS NOT NULL');
    expect(fromSql.find((c) => c.name.endsWith("period_check"))!.expr).toBe('"period_from" IS NULL OR "period_to" IS NULL OR "period_from" <= "period_to"');
  });

  it("money columns keep two decimals; line amounts are numeric(14,2)", () => {
    const lines = getTableConfig(collectionBalanceLines).columns;
    for (const n of ["debit", "credit"]) expect(sqlType(lines.find((c) => c.name === n)!.getSQLType())).toBe("numeric(14,2)");
    expect(sqlText).toMatch(/"debit" numeric\(14, 2\),/);
    expect(sqlText).toMatch(/"credit" numeric\(14, 2\)/);
  });
});

describe("migration 0117 security and dependencies", () => {
  it("enables row-level security with no policies on both tables, and revokes anon / authenticated", () => {
    for (const [name] of TABLES) expect(code).toContain(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY;`);
    expect(code).not.toMatch(/CREATE POLICY/i);
    expect(code).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.%I FROM %I/);
    expect(code).toMatch(/ARRAY\['anon', 'authenticated'\]/);
    expect(code).not.toMatch(/\bGRANT\b/i);
  });

  it("depends only on employees (0000) and collection_master_companies (0112) — not on 0113", () => {
    const refs = new Set([...code.matchAll(/REFERENCES "([a-z_]+)"/g)].map((m) => m[1]));
    expect([...refs].sort()).toEqual(["collection_balance_snapshots", "collection_master_companies", "employees"]);
    expect(code).not.toMatch(/attendance|salary/i);
  });

  it("is idempotent and does not destroy anything", () => {
    // "ON DELETE …" clauses are fine; statements that remove or rewrite data are not.
    expect(code).not.toMatch(/\b(DROP|TRUNCATE)\b|^\s*(DELETE FROM|UPDATE)\b|\bRENAME\b/im);
    for (const m of code.matchAll(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)) throw new Error(`non-idempotent index: ${m[0]}`);
    for (const m of code.matchAll(/CREATE TABLE (?!IF NOT EXISTS)/g)) throw new Error(`non-idempotent table: ${m[0]}`);
  });

  it("states that it is for review and not applied", () => {
    expect(sqlText).toMatch(/NOT APPLIED/);
  });
});
