import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, salesOrderFieldHistory, salesOrderFieldSettings } from "@/db/schema";
import { isMissingTable } from "@/lib/queries/collection-master";
import {
  BASE_CATALOGUE,
  buildCatalogue,
  customKey,
  sectionKey,
  settingFromRow,
  validateSection,
  validateSetting,
  type FieldSetting,
  type SectionInput,
  type SettingInput,
  type SoCatalogue,
} from "@/lib/tally/sales-order-config";

/**
 * The stored Sales Order field and section settings (migration 0128) and the effective configuration built from them.
 * Nothing here authorizes: callers hold the permission (lib/auth/sales-order-fields.ts) or only read.
 *
 * Without migration 0128 the settings simply don't exist: every reader gets the Tally matrix as it is (version 0),
 * so the Sales Order screens and imports keep working, and saving a setting says the update is needed.
 *
 * HELP TEXT lives in one column added by migration 0130 (`help_text`). It is deliberately NOT declared on the Drizzle
 * table: Drizzle names every declared column in an INSERT, which would break saving any setting on a database that
 * doesn't have 0130 yet. It is read and written here with plain SQL, only when the column exists; without it every
 * other setting works and saving a help text says the update is needed.
 */

type Q = typeof db;

export interface CatalogueLoad {
  /** False while migration 0128 isn't applied. */
  ready: boolean;
  /** False while migration 0130 (the help-text column) isn't applied. */
  helpTextReady: boolean;
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
/** The settings columns to read: 0130's help text when the database has it, an empty one when it doesn't. */
const settingColumns = (helpText: boolean) => ({ ...SETTING_COLUMNS, helpText: helpText ? sql<string | null>`"sales_order_field_settings"."help_text"` : sql<string | null>`null` });

const NOT_READY_0130 = "Help text needs database update 0130 first, so nothing was saved.";
const STALE = "This setting was changed by someone else meanwhile. Nothing was saved; reload to see the current setting.";

/** Which of the settings' migrations the database has — asked in a way that can't fail, so it is safe inside a transaction. */
async function settingsCapabilities(q: Q): Promise<{ ready: boolean; helpText: boolean }> {
  const r = await q.execute(sql`select
    to_regclass('public.sales_order_field_settings') is not null and to_regclass('public.sales_order_field_history') is not null as ok,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_order_field_settings' and column_name = 'help_text') as help`);
  const rows = (Array.isArray(r) ? r : ((r as unknown as { rows?: unknown[] }).rows ?? [])) as { ok: boolean; help: boolean }[];
  return { ready: rows[0]?.ok === true, helpText: rows[0]?.help === true };
}

/**
 * The effective configuration now. Read-only; inside a transaction when given one, so a check and a write agree.
 * The tables' existence is checked first: a failed query would abort the caller's transaction (an import's), so a
 * database without 0128 must never be asked for them.
 */
export async function loadSalesOrderCatalogue(q: Q = db): Promise<CatalogueLoad> {
  const caps = await settingsCapabilities(q);
  if (!caps.ready) return { ready: false, helpTextReady: false, catalogue: BASE_CATALOGUE, settings: [] };
  try {
    const [rows, [v]] = await Promise.all([
      q.select(settingColumns(caps.helpText)).from(salesOrderFieldSettings),
      q.select({ v: sql<number>`coalesce(max(${salesOrderFieldHistory.version}), 0)::bigint` }).from(salesOrderFieldHistory),
    ]);
    const settings = rows.map(settingFromRow);
    return { ready: true, helpTextReady: caps.helpText, catalogue: buildCatalogue(settings, Number(v?.v ?? 0)), settings };
  } catch (err) {
    if (isMissingTable(err)) return { ready: false, helpTextReady: false, catalogue: BASE_CATALOGUE, settings: [] };
    throw err;
  }
}

export type SaveResult = { ok: true; fieldKey: string; version: number } | { ok: false; error: string };

type RowValues = Pick<typeof salesOrderFieldSettings.$inferInsert, "isCustom" | "scope" | "label" | "section" | "displayOrder" | "requirement" | "condition" | "fieldType" | "options" | "inForm" | "inImport" | "onOrderPage" | "status">;

/**
 * Writes one settings row (a field's or a section's) and appends the change to the history, which numbers the new
 * configuration version. `expectedRowVersion` must be the row's version the screen read (0 = it had no row): a change
 * made meanwhile is never overwritten. `helpText`: undefined keeps what is stored. Rows are never deleted (the
 * database refuses it).
 */
async function writeSetting(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actorId: string,
  key: string,
  values: RowValues,
  helpText: string | null | undefined,
  helpTextReady: boolean,
  expectedRowVersion: number,
  mustExist: boolean,
): Promise<SaveResult> {
  const q = tx as unknown as Q;
  const text = helpText === undefined ? undefined : helpText?.trim() || null;
  // Asked for before anything is written: a database without 0130 has nowhere to keep it.
  if (text && !helpTextReady) return { ok: false, error: NOT_READY_0130 };
  const [row] = await q.select(settingColumns(helpTextReady)).from(salesOrderFieldSettings).where(eq(salesOrderFieldSettings.fieldKey, key)).limit(1);
  if ((row?.rowVersion ?? 0) !== expectedRowVersion) return { ok: false, error: STALE };
  if (!row && mustExist) return { ok: false, error: "That custom field doesn't exist." };
  const action = !row ? "create" : row.status !== values.status ? (values.status === "retired" ? "retire" : "restore") : "update";
  if (row) {
    await tx
      .update(salesOrderFieldSettings)
      .set({ ...values, rowVersion: row.rowVersion + 1, updatedById: actorId, updatedAt: new Date() })
      .where(eq(salesOrderFieldSettings.fieldKey, key));
  } else {
    await tx.insert(salesOrderFieldSettings).values({ fieldKey: key, ...values, createdById: actorId, updatedById: actorId });
  }
  if (helpTextReady && text !== undefined) await tx.execute(sql`update sales_order_field_settings set help_text = ${text} where field_key = ${key}`);
  const before = row ? settingFromRow(row) : null;
  const after = { ...values, fieldKey: key, ...(helpTextReady ? { helpText: text === undefined ? (row?.helpText ?? null) : text } : {}) };
  const [h] = await tx.insert(salesOrderFieldHistory).values({ fieldKey: key, action, before, after, changedById: actorId }).returning({ version: salesOrderFieldHistory.version });
  return { ok: true, fieldKey: key, version: Number(h!.version) };
}

/**
 * Saves one field's setting: a change to a matrix field or an existing custom field, a new custom field, enabling
 * or disabling one. One transaction, serialised with every other settings change; the input is validated against the
 * configuration as it is NOW (not as the screen saw it).
 */
export async function saveFieldSetting(actorId: string, input: SettingInput, expectedRowVersion: number): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales_order_field_settings'))`);
    const { catalogue, helpTextReady } = await loadSalesOrderCatalogue(q);
    const key = input.fieldKey ?? (input.isCustom && input.label ? customKey(input.label, catalogue) : null);
    if (!key) return { ok: false as const, error: "Name the field." };
    const errors = validateSetting({ ...input, fieldKey: key }, catalogue);
    if (errors.length) return { ok: false as const, error: errors.join(" ") };
    const values: RowValues = {
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
    return writeSetting(tx, actorId, key, values, input.helpText, helpTextReady, expectedRowVersion, !!input.fieldKey && input.isCustom);
  });
}

/**
 * Saves one section's settings — its display label, order, enabled / disabled, help text — or adds a custom section.
 * The same transaction, lock, version check and history as a field's: a section's row is keyed "section_…" and holds
 * the section's name in `section`. Disabling a section writes nothing to its fields or to any order.
 */
export async function saveSectionSetting(actorId: string, input: SectionInput, expectedRowVersion: number): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    const q = tx as unknown as Q;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales_order_field_settings'))`);
    const { catalogue, helpTextReady } = await loadSalesOrderCatalogue(q);
    const errors = validateSection(input, catalogue);
    if (errors.length) return { ok: false as const, error: errors.join(" ") };
    const name = input.name.trim();
    const key = catalogue.sectionByName.get(name)?.key ?? sectionKey(name, new Set(catalogue.sectionList.map((s) => s.key)));
    const label = input.label?.trim() || null;
    const values: RowValues = {
      isCustom: false,
      // A section belongs to no scope; the column needs one of its values.
      scope: "voucher",
      label: label === name ? null : label,
      section: name,
      displayOrder: input.displayOrder,
      requirement: null,
      condition: null,
      fieldType: null,
      options: null,
      inForm: true,
      inImport: true,
      onOrderPage: true,
      status: input.status,
    };
    return writeSetting(tx, actorId, key, values, input.helpText, helpTextReady, expectedRowVersion, false);
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
