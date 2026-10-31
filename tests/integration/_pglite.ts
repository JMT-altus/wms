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
export async function createTestDb(requested: Record<string, unknown>) {
  const pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec("create extension if not exists pg_trgm"); // some tables index with gin_trgm_ops
  // Every Postgres enum type the schema declares (columns reference them by name).
  const enums = Object.fromEntries(Object.entries(schema).filter(([, v]) => isPgEnum(v)));
  // Module access is part of every request's authorization (Collection's guards read it),
  // so every test database has the real table, starting EMPTY: admins pass through the
  // real admin bypass and anyone else needs a real grant, exactly as in production.
  const tables = { moduleAccessGrants: schema.moduleAccessGrants, ...requested };
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
  await pg.exec(MODULE_ACCESS_CONSTRAINTS);
  const db = drizzle(pg, { schema });
  return { pg, db, skippedForeignKeys };
}

/** What migration 0076 adds beyond db/schema.ts, so a test can't store a grant production would refuse. */
const MODULE_ACCESS_CONSTRAINTS = `
  ALTER TABLE module_access_grants ADD CONSTRAINT module_access_grants_subject_ck CHECK (
    (subject_type = 'everyone' AND subject_id IS NULL)
    OR (subject_type IN ('department', 'employee') AND subject_id IS NOT NULL)
  );
  CREATE UNIQUE INDEX module_access_grants_everyone_uq ON module_access_grants (module_id) WHERE subject_type = 'everyone';
  CREATE UNIQUE INDEX module_access_grants_subject_uq ON module_access_grants (module_id, subject_type, subject_id) WHERE subject_id IS NOT NULL;
`;

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
