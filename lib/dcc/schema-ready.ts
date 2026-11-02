import "server-only";
import { getTableColumns, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dccKpiItems } from "@/db/schema";

/**
 * Migration 0124 adds `input_type` and `target_period` to `dcc_kpi_items`.
 * Until it is installed, every read that lists those columns fails with
 * "column input_type does not exist" — which is what a `db.select()` of the
 * whole table does. So the DCC reads ask ONCE whether the columns exist and,
 * if not, select the pre-0124 columns and fill the two in with their defaults
 * ('yesno' / 'day'): exactly the values 0124 will give every existing row.
 *
 * Same approach as the 0123 fallback in lib/queries/collection-review.ts.
 * A `true` answer is kept for the process; a `false` one is re-checked every
 * 30 s so the app picks the migration up without a restart.
 */
let ready: boolean | null = null;
let checkedAt = 0;

export async function dccInputTypeReady(): Promise<boolean> {
  if (ready === true) return true;
  if (ready === false && Date.now() - checkedAt < 30_000) return false;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sql`information_schema.columns`)
    .where(sql`table_schema = current_schema() and table_name = 'dcc_kpi_items' and column_name = 'input_type'`);
  ready = (row?.n ?? 0) > 0;
  checkedAt = Date.now();
  return ready;
}

/** Tests only: forget the answer after changing the table. */
export function _resetDccSchemaMemo(): void {
  ready = null;
  checkedAt = 0;
}

const FULL = getTableColumns(dccKpiItems);
const { inputType: _i, targetPeriod: _t, ...REST } = FULL;
void _i;
void _t;
/** The pre-0124 column list, with the two new ones as their defaults. */
const LEGACY = {
  ...REST,
  inputType: sql<"number" | "yesno" | "text">`'yesno'`.as("input_type"),
  targetPeriod: sql<"day" | "week" | "month">`'day'`.as("target_period"),
};

/**
 * What to `select()` from `dcc_kpi_items`: every column when 0124 is
 * installed, the legacy list with defaults when it is not. Either way the row
 * is a full `DccKpiItem`.
 */
export async function kpiItemColumns(): Promise<typeof FULL> {
  return ((await dccInputTypeReady()) ? FULL : LEGACY) as unknown as typeof FULL;
}
