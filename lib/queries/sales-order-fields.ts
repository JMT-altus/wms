import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, salesOrderFieldHistory, salesOrderFieldSettings } from "@/db/schema";
import { isMissingTable } from "@/lib/queries/collection-master";
import { BASE_CATALOGUE, buildCatalogue, customKey, settingFromRow, validateSetting, type FieldSetting, type SettingInput, type SoCatalogue } from "@/lib/tally/sales-order-config";

/**
 * The stored Sales Order field settings (migration 0128) and the effective configuration built from them. Nothing
 * here authorizes: callers hold the permission (lib/auth/sales-order-fields.ts) or only read.
 *
 * Without migration 0128 the settings simply don't exist: every reader gets the Tally matrix as it is (version 0),
 * so the Sales Order screens and imports keep working, and saving a setting says the update is needed.
 */

type Q = typeof db;

export interface CatalogueLoad {
  /** False while migration 0128 isn't applied. */
  ready: boolean;
  catalogue: SoCatalogue;
  settings: FieldSetting[];
}

const SETTING_COLUMNS = {
  fieldKey: salesOrderFieldSettings.fieldKey,
  isCustom: salesOrderFieldSettings.isCustom,
  scope: salesOrderFieldSettings.scope,
  label: salesOrderFieldSettings.label,
  section: salesOrderFieldSettings.section,
  displayOrder: salesOrderFieldSettings.displayOrder,
  requirement: salesOrderFieldSettings.requirement,
  condition: salesOrderFieldSettings.condition,
  fieldType: salesOrderFieldSettings.fieldType,
  options: salesOrderFieldSettings.options,
  inForm: salesOrderFieldSettings.inForm,
  inImport: salesOrderFieldSettings.inImport,
  onOrderPage: salesOrderFieldSettings.onOrderPage,
  status: salesOrderFieldSettings.status,
  rowVersion: salesOrderFieldSettings.rowVersion,
};

/** Whether migration 0128's tables exist — asked in a way that can't fail, so it is safe inside a transaction. */
async function settingsTableExists(q: Q): Promise<boolean> {
  const r = await q.execute(sql`select to_regclass('public.sales_order_field_settings') is not null and to_regclass('public.sales_order_field_history') is not null as ok`);
  const rows = (Array.isArray(r) ? r : ((r as unknown as { rows?: unknown[] }).rows ?? [])) as { ok: boolean }[];
  return rows[0]?.ok === true;
}

/**
 * The effective configuration now. Read-only; inside a transaction when given one, so a check and a write agree.
 * The tables' existence is checked first: a failed query would abort the caller's transaction (an import's), so a
 * database without 0128 must never be asked for them.
 */
export async function loadSalesOrderCatalogue(q: Q = db): Promise<CatalogueLoad> {
  if (!(await settingsTableExists(q))) return { ready: false, catalogue: BASE_CATALOGUE, settings: [] };
  try {
    const [rows, [v]] = await Promise.all([
      q.select(SETTING_COLUMNS).from(salesOrderFieldSettings),
      q.select({ v: sql<number>`coalesce(max(${salesOrderFieldHistory.version}), 0)::bigint` }).from(salesOrderFieldHistory),
    ]);
    const settings = rows.map(settingFromRow);
    return { ready: true, catalogue: buildCatalogue(settings, Number(v?.v ?? 0)), settings };
  } catch (err) {
    if (isMissingTable(err)) return { ready: false, catalogue: BASE_CATALOGUE, settings: [] };
    throw err;
  }
}

export type SaveResult = { ok: true; fieldKey: string; version: number } | { ok: false; error: string };

/**
 * Saves one field's setting: a change to a matrix field or an existing custom field, a new custom field, a
 * retirement or a restore. One transaction, serialised with every other settings change:
 *   - the input is validated against the configuration as it is NOW (not as the screen saw it);
 *   - `expectedRowVersion` must be the row's version the screen read (0 = it had no row): a change made meanwhile
 *     is never overwritten;
 *   - the row is written and the change appended to the history, which numbers the new configuration version.
 * Rows are never deleted (the database refuses it).
 */
export async function saveFieldSetting(actorId: string, input: SettingInput, expectedRowVersion: number): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales_order_field_settings'))`);
    const { catalogue } = await loadSalesOrderCatalogue(q);
    const key = input.fieldKey ?? (input.isCustom && input.label ? customKey(input.label, catalogue) : null);
    if (!key) return { ok: false as const, error: "Name the field." };
    const errors = validateSetting({ ...input, fieldKey: key }, catalogue);
    if (errors.length) return { ok: false as const, error: errors.join(" ") };
    const [row] = await q.select(SETTING_COLUMNS).from(salesOrderFieldSettings).where(eq(salesOrderFieldSettings.fieldKey, key)).limit(1);
    if ((row?.rowVersion ?? 0) !== expectedRowVersion) {
      return { ok: false as const, error: "This field was changed by someone else meanwhile. Nothing was saved; reload to see the current setting." };
    }
    if (!row && input.fieldKey && input.isCustom) return { ok: false as const, error: "That custom field doesn't exist." };
    const values = {
      isCustom: input.isCustom,
      scope: input.scope,
      label: input.label?.trim() || null,
      section: input.section?.trim() || null,
      displayOrder: input.displayOrder,
      requirement: input.requirement,
      condition: input.condition,
      fieldType: input.isCustom ? input.fieldType : null,
      options: input.options ? input.options.map((o) => o.trim()).filter(Boolean) : null,
      inForm: input.inForm,
      inImport: input.inImport,
      onOrderPage: input.onOrderPage,
      status: input.status,
    };
    const action = !row ? "create" : row.status !== input.status ? (input.status === "retired" ? "retire" : "restore") : "update";
    if (row) {
      await tx
        .update(salesOrderFieldSettings)
        .set({ ...values, rowVersion: row.rowVersion + 1, updatedById: actorId, updatedAt: new Date() })
        .where(eq(salesOrderFieldSettings.fieldKey, key));
    } else {
      await tx.insert(salesOrderFieldSettings).values({ fieldKey: key, ...values, createdById: actorId, updatedById: actorId });
    }
    const before = row ? settingFromRow(row) : null;
    const [h] = await tx
      .insert(salesOrderFieldHistory)
      .values({ fieldKey: key, action, before, after: { ...values, fieldKey: key }, changedById: actorId })
      .returning({ version: salesOrderFieldHistory.version });
    return { ok: true as const, fieldKey: key, version: Number(h!.version) };
  });
}

export interface FieldHistoryRow {
  version: number;
  fieldKey: string;
  action: string;
  before: unknown;
  after: unknown;
  changedBy: string | null;
  changedAt: Date;
}

export async function listFieldHistory(limit = 100): Promise<{ ready: boolean; rows: FieldHistoryRow[] }> {
  try {
    const rows = await db
      .select({ version: salesOrderFieldHistory.version, fieldKey: salesOrderFieldHistory.fieldKey, action: salesOrderFieldHistory.action, before: salesOrderFieldHistory.before, after: salesOrderFieldHistory.after, changedBy: employees.name, changedAt: salesOrderFieldHistory.changedAt })
      .from(salesOrderFieldHistory)
      .leftJoin(employees, eq(employees.id, salesOrderFieldHistory.changedById))
      .orderBy(desc(salesOrderFieldHistory.version))
      .limit(limit);
    return { ready: true, rows: rows.map((r) => ({ ...r, version: Number(r.version) })) };
  } catch (err) {
    if (isMissingTable(err)) return { ready: false, rows: [] };
    throw err;
  }
}

/** Records the configuration version an import was validated against (0128's batch column). A database without it is left as it is. */
export async function recordBatchFieldVersion(q: Q, batchId: string, version: number): Promise<void> {
  try {
    await q.execute(sql`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_import_batches' and column_name = 'field_config_version' limit 1`).then(async (r) => {
      const has = Array.isArray(r) ? r.length > 0 : ((r as unknown as { rows?: unknown[] }).rows?.length ?? 0) > 0;
      if (has) await q.execute(sql`update tally_import_batches set field_config_version = ${version} where id = ${batchId}`);
    });
  } catch (err) {
    if (isMissingTable(err)) return;
    throw err;
  }
}
