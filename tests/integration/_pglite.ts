import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { isPgEnum } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@/db/schema";

/**
 * A throwaway, in-memory Postgres (PGlite — Postgres compiled to WebAssembly,
 * running inside the test process). No network, no files, no shared database:
 * it cannot reach production or any other server.
 *
 * The tables are generated from db/schema.ts (the same Drizzle definitions the
 * app uses) for just the tables a test needs. Foreign keys that point at
 * tables NOT created are skipped and listed in `skippedForeignKeys`; every
 * other statement must succeed.
 *
 * Limits, stated plainly: PGlite is a single connection, so two transactions
 * can't truly run at once (concurrency is tested by interleaving: one save
 * lands between another's read and write). It also isn't Supabase: there is no
 * PostgREST, so REST-role access is tested at the Postgres privilege level.
 */
export async function createTestDb(tables: Record<string, unknown>) {
  const pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec("create extension if not exists pg_trgm"); // some tables index with gin_trgm_ops
  // Every Postgres enum type the schema declares (columns reference them by name).
  const enums = Object.fromEntries(Object.entries(schema).filter(([, v]) => isPgEnum(v)));
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ ...enums, ...tables }));
  const skippedForeignKeys: string[] = [];
  for (const sql of statements) {
    try {
      await pg.exec(sql);
    } catch (err) {
      if (/FOREIGN KEY/i.test(sql) && /does not exist/i.test((err as Error).message)) {
        skippedForeignKeys.push(sql.slice(0, 120));
        continue;
      }
      throw new Error(`Test schema statement failed: ${(err as Error).message}\n${sql}`);
    }
  }
  const db = drizzle(pg, { schema });
  return { pg, db, skippedForeignKeys };
}

/** The tables the attendance correction + salary checks touch. */
export const ATTENDANCE_TABLES = {
  employees: schema.employees,
  orgSettings: schema.orgSettings,
  attendanceLogs: schema.attendanceLogs,
  employeeEvents: schema.employeeEvents,
  salaryRuns: schema.salaryRuns,
  holidays: schema.holidays,
  leaveRequests: schema.leaveRequests,
  compOffCredits: schema.compOffCredits,
  attendancePolicyChanges: schema.attendancePolicyChanges,
};
