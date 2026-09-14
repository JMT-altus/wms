"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ClientMasterRow } from "@/lib/queries/client-kyc";
import { formatInr } from "@/lib/format";
import { deleteMasterCustomer } from "@/app/(masters-module)/masters/actions";
import {
  reactivateClients,
  setClientsDormant,
  updateClientMasterRecord,
  updateClientProducts,
} from "@/app/(forms-module)/forms/client-kyc/actions";
import {
  STATUS_FILTER_DEFAULT,
  STATUS_FILTER_OPTIONS,
  customerCountLabel,
  isDormant,
  matchesStatusFilter,
  statusLabel,
} from "@/lib/masters/dormancy";
import {
  RecordEditDialog,
  asOptions,
  type EditField,
  type EditValues,
} from "./kyc/record-edit-dialog";
import type { EmployeeOption } from "@/lib/queries/employees";
import {
  DataTable,
  Dash,
  type Column,
  type FilterDef,
  type SortDef,
} from "@/components/admin/master/data-table";
import { CodeCell, StatusCell } from "@/components/masters/row-menu";
import { ClientBulkImport } from "./client-bulk-import";
import type { ClientBulkOptions } from "@/lib/forms/client-bulk-columns";
import { FileSpreadsheet, FileText, MoonStar, Sunrise } from "lucide-react";
import { ClientMasterGrid } from "./client-master-grid";
import { ViewSwitch } from "@/components/admin/master/view-switch";
import {
  InlineMulti,
  InlineNumber,
  InlineSelect,
  type SaveResult,
} from "@/components/admin/master/inline-edit";
import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./kyc/fields";

/**
 * Client Master — every client Create New Client KYC has onboarded.
 *
 * Reads `customer_masters` through `listClientMasterRows`, the same rows the
 * KYC form writes, so there is no second client store to keep in sync: edit a
 * client's KYC and this table shows the new values on the next load.
 *
 * The table itself is the shared `DataTable` (search, filter chips, sort,
 * CSV export, 25/50/100 pagination) rather than a bespoke grid — Product and
 * Customer Master already use it, and its pagination is the app's existing
 * answer to "there may be thousands of rows".
 */

/** Export vs Domestic, from the KYC form's Export Yes/No. */
function tradeOf(r: ClientMasterRow): "Export" | "Domestic" {
  return r.exportClient?.trim().toLowerCase() === "yes" ? "Export" : "Domestic";
}

function hasGstin(r: ClientMasterRow): boolean {
  return Boolean(r.gstin && r.gstin.trim());
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Distinct values across a multi-value column, for its filter chip. */
function distinctFrom(rows: ClientMasterRow[], pick: (r: ClientMasterRow) => string[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const v of pick(r)) if (v.trim()) seen.add(v.trim());
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Comma-separated text is how the dialog CARRIES the three list fields.
 *
 * Customer Type, Industry Type and Tags are arrays on the row and chip
 * pickers in the dialog; `EditValues` holds strings and booleans, so they
 * travel through it joined and come back split. The options behind the
 * pickers are the master lists themselves (`bulkOptions`) — the same ones the
 * KYC form offers — so neither screen can drift from the other, and a
 * genuinely new option is still added in the library screen that owns it.
 */
const listToText = (v: string[]) => v.join(", ");
const textToList = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * The dialog's field list, in the same order as the table's columns.
 *
 * Every field that has a master list behind it is a picker rather than a text
 * box, fed from `bulkOptions` — the same lists the KYC form's own pickers and
 * the Bulk Import sheet's dropdown cells read. Three screens writing one
 * `customer_masters` row must offer the same options, or a value typed here
 * is one the form can't show back.
 *
 * Which control each list gets follows what the schema does with it:
 *
 *   multi   Customer Type, Industry Type, Tags — arrays on the row.
 *   combo   State, Payment Terms, Transporter and the rest — free text on the
 *           row, so the list is a suggestion and a value off it still saves.
 *   select  Sales Co-ordinator, Grade, Export — a closed set; anything else
 *           is either a broken foreign key or outside an enum.
 *   number  Credit Limit and Credit Days, with −/+ steppers.
 */
function editFields(salesPeople: EmployeeOption[], o: ClientBulkOptions, tags: string[]): EditField[] {
  return [
    /* Identity */
    { key: "name", label: "Company Name", span: 2, maxLength: 200 },
    { key: "gstin", label: "GSTIN", span: 2, maxLength: 20 },
    { key: "reference", label: "Reference", span: 2, maxLength: 200 },
    {
      key: "salesRepId",
      label: "Sales Co-ordinator",
      type: "select",
      span: 2,
      options: salesPeople.map((e) => ({ value: e.id, label: e.name })),
    },
    {
      key: "grade",
      label: "Grade",
      type: "select",
      span: 1,
      options: asOptions(GRADES),
    },
    {
      key: "customerTypes",
      label: "Customer Type",
      type: "multi",
      span: 3,
      options: asOptions(o.customerTypes),
    },
    {
      key: "industryTypes",
      label: "Industry Type",
      type: "multi",
      span: 2,
      options: asOptions(o.industryTypes),
    },
    // Tags are the one list with no master behind it — they're coined per
    // client — so the picker offers what other clients already use and still
    // takes a new one.
    { key: "tags", label: "Tags", type: "multi", span: 2, options: asOptions(tags), allowCustom: true },

    /* Registration & Tax */
    { key: "panNo", label: "PAN / IT No", span: 2, maxLength: 20 },
    { key: "msmeUdyamNo", label: "MSME / Udyam No", span: 2, maxLength: 40 },
    {
      key: "gstRegistrationType",
      label: "GST Registration Type",
      type: "combo",
      span: 2,
      maxLength: 60,
      options: asOptions(o.gstRegistrationTypes),
    },
    { key: "state", label: "State", type: "combo", span: 2, maxLength: 120, options: asOptions(o.states) },
    { key: "tinNumber", label: "TIN No", span: 2, maxLength: 40 },
    { key: "website", label: "Website", span: 2, maxLength: 200 },
    {
      key: "testCertificateNeeded",
      label: "Test Certificate Needed",
      type: "checkbox",
      span: 2,
      placeholder: "Required",
    },
    { key: "tcsApplicable", label: "TCS Applicable", type: "checkbox", span: 2, placeholder: "Applies" },

    /* Commercial & Credit */
    {
      key: "paymentTerms",
      label: "Payment Terms",
      type: "combo",
      span: 2,
      maxLength: 120,
      options: asOptions(o.paymentTerms),
    },
    {
      key: "freightCharges",
      label: "Freight Charges",
      type: "combo",
      span: 2,
      maxLength: 120,
      options: asOptions(o.freightCharges),
    },
    { key: "creditDays", label: "Credit Days", type: "number", span: 2, step: 15, placeholder: "0" },
    // Steps of a lakh — the unit credit limits are actually reviewed in, and
    // the increment the Credit Limit master list itself is written in.
    {
      key: "creditLimit",
      label: "Credit Limit",
      type: "number",
      span: 2,
      step: 100000,
      format: "inr",
      placeholder: "0",
    },
    {
      key: "transporter",
      label: "Transporter",
      type: "combo",
      span: 2,
      maxLength: 160,
      options: asOptions(o.transporters),
    },
    {
      key: "quantityDeviation",
      label: "Quantity Deviation",
      type: "combo",
      span: 2,
      maxLength: 60,
      options: asOptions(o.quantityDeviations),
    },
    { key: "otherReferences", label: "Other References", span: 4, maxLength: 400 },
    { key: "notes", label: "Client Notes", type: "textarea", span: 4, maxLength: 2000 },

    /* Export Details */
    { key: "exportClient", label: "Export", type: "select", span: 2, options: YES_NO_OPTIONS },
    { key: "iecNumber", label: "IEC Code", span: 2, maxLength: 40 },
    {
      key: "currency",
      label: "Currency",
      type: "combo",
      span: 2,
      maxLength: 20,
      options: asOptions(o.currencies),
    },
    {
      key: "country",
      label: "Country",
      type: "combo",
      span: 2,
      maxLength: 80,
      options: asOptions(o.countries),
    },

    /* The record's own two flags, last — see the dialog footer in the design */
    { key: "isActive", label: "Active", type: "checkbox", span: 2, placeholder: "Active" },
    {
      key: "focusedView",
      label: "Focused View",
      type: "checkbox",
      span: 2,
      placeholder: "Add to Focused View List",
    },
  ];
}

/** The Export field's two answers — a dropdown in the cell, a select in the dialog. */
const YES_NO = ["Yes", "No"] as const;
const YES_NO_OPTIONS = asOptions(YES_NO);

/** Volume class, the KYC form's "Grade". */
const GRADES = ["A", "B", "C"] as const;

/** Every value the dialog edits, as the strings and booleans it works in. */
function toEditValues(r: ClientMasterRow): EditValues {
  return {
    name: r.name,
    gstin: r.gstin ?? "",
    reference: r.reference ?? "",
    salesRepId: r.salesRepId ?? "",
    grade: r.grade ?? "",
    customerTypes: listToText(r.customerTypes),
    industryTypes: listToText(r.industryTypes),
    tags: listToText(r.tags),
    panNo: r.panNo ?? "",
    msmeUdyamNo: r.msmeUdyamNo ?? "",
    gstRegistrationType: r.gstRegistrationType ?? "",
    state: r.state ?? "",
    tinNumber: r.tinNumber ?? "",
    website: r.website ?? "",
    testCertificateNeeded: r.testCertificateNeeded,
    tcsApplicable: r.tcsApplicable,
    paymentTerms: r.paymentTerms ?? "",
    freightCharges: r.freightCharges ?? "",
    creditDays: r.creditDays === null ? "" : String(r.creditDays),
    creditLimit: r.creditLimit ?? "",
    transporter: r.transporter ?? "",
    quantityDeviation: r.quantityDeviation ?? "",
    otherReferences: r.otherReferences ?? "",
    notes: r.notes ?? "",
    exportClient: r.exportClient ?? "",
    iecNumber: r.iecNumber ?? "",
    currency: r.currency ?? "",
    country: r.country ?? "",
    isActive: r.isActive,
    focusedView: r.focusedView,
  };
}

/** Back to the shape `ClientMasterEditSchema` parses. */
function fromEditValues(v: EditValues) {
  const str = (k: string) => String(v[k] ?? "");
  return {
    ...v,
    customerTypes: textToList(str("customerTypes")),
    industryTypes: textToList(str("industryTypes")),
    tags: textToList(str("tags")),
    // Blank means "no grade", which the schema takes as null rather than a
    // value outside its enum.
    grade: str("grade") === "" ? null : str("grade"),
    // "10,00,000" is how a lakh figure gets typed; Number() would make that
    // NaN and trip the validator over formatting alone.
    creditLimit: str("creditLimit").replace(/,/g, ""),
    creditDays: str("creditDays").replace(/,/g, ""),
  };
}

export function ClientMasterTable({
  clients,
  salesPeople,
  bulkOptions,
  title = "Client Master",
  csvName = "client-master",
}: {
  clients: ClientMasterRow[];
  /** Fills the edit dialog's Sales Co-ordinator picker. */
  salesPeople: EmployeeOption[];
  /** The master lists behind Bulk Import's dropdown cells. */
  bulkOptions: ClientBulkOptions;
  /**
   * The heading, for the OTHER route that renders this screen.
   *
   * The Masters module's Customer Master is this table: one
   * `customer_masters` register, one set of columns, one way to edit it. It
   * used to be a narrower screen of its own, which meant every column, filter
   * and export added here had to be added there too — and never was. Only the
   * name over it differs, because that is what the rail calls the route.
   */
  title?: string;
  /** Names the CSV that screen downloads. */
  csvName?: string;
}) {
  const [editing, setEditing] = React.useState<ClientMasterRow | null>(null);
  /**
   * Table or Grid.
   *
   * Two readings of the same rows, not two screens: Table is for finding a
   * client and correcting it, Grid is for the pass where a column needs
   * filling in across the register. Both write through the same action, so
   * neither is the "real" one.
   */
  const [view, setView] = React.useState<"table" | "grid">("table");
  const router = useRouter();
  /** Keeps the Set Dormant button disabled while its write is in flight. */
  const [pending, start] = React.useTransition();

  /**
   * Tags already in use, as the Tags picker's suggestions.
   *
   * Derived from the rows rather than a master list because there isn't one —
   * tags are coined per client. Offering the ones already on the register is
   * what stops "Repeat" and "repeat buyer" becoming two tags.
   */
  const tagSuggestions = React.useMemo(() => distinctFrom(clients, (r) => r.tags), [clients]);

  /** The Sales Co-ordinator picker works in names; the row stores an id. */
  const salesNames = React.useMemo(() => salesPeople.map((e) => e.name), [salesPeople]);
  const salesIdByName = React.useMemo(
    () => new Map(salesPeople.map((e) => [e.name, e.id])),
    [salesPeople],
  );

  /**
   * Set a client's Product Types.
   *
   * Its own action, not `patch`: products are `customer_product_map` rows,
   * not a column on the client, and `updateClientMasterRecord` writes the
   * client row only.
   */
  const saveProducts = React.useCallback(
    async (row: ClientMasterRow, names: string[]): Promise<SaveResult> => {
      const res = await updateClientProducts(row.id, names);
      if (!res.ok) return { ok: false, error: res.error };
      router.refresh();
      return { ok: true };
    },
    [router],
  );

  /**
   * Save one field of one row, from a cell that was edited in place.
   *
   * Sends the whole client each time, rebuilt from the row with the one
   * change applied — `updateClientMasterRecord` takes a complete record, and
   * a partial write path built just for these cells would be a second way to
   * update a client that could drift from the dialog's. The row is what the
   * server last told us, so nothing else on it moves.
   */
  const patch = React.useCallback(
    async (row: ClientMasterRow, changes: EditValues): Promise<SaveResult> => {
      const res = await updateClientMasterRecord(
        row.id,
        fromEditValues({ ...toEditValues(row), ...changes }),
      );
      if (!res.ok) return { ok: false, error: res.error };
      router.refresh();
      return { ok: true };
    },
    [router],
  );

  /**
   * Bulk delete from the selection bar.
   *
   * Sequential rather than parallel: `deleteMasterCustomer` revalidates on
   * every call, and firing fifty of those at once floods the pool for no
   * gain on a list this size. Stops at the first failure and says how far it
   * got, so a partial delete is never reported as a clean one.
   */
  /**
   * Park the selection as dormant, or bring it back.
   *
   * One button that flips, decided by the selection itself: with anything
   * still on the register it parks, and only when every picked row is already
   * dormant does it offer Reactivate. A pair of buttons would put "Set
   * Dormant" next to rows that already are.
   */
  function toggleDormant(selected: ClientMasterRow[], clear: () => void) {
    if (selected.length === 0) return;
    const reactivating = selected.every(isDormant);
    start(async () => {
      try {
        const res = reactivating
          ? await reactivateClients(selected.map((r) => r.id))
          : await setClientsDormant(selected.map((r) => r.id));
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(
          reactivating
            ? `${customerCountLabel(res.count)} back on the register.`
            : `${customerCountLabel(res.count)} set dormant — hidden until Status is set to Dormant.`,
        );
        clear();
        router.refresh();
      } catch {
        toast.error("Couldn't reach the server. Try again in a moment.");
      }
    });
  }

  async function removeSelected(selected: ClientMasterRow[]) {
    let done = 0;
    for (const row of selected) {
      const res = await deleteMasterCustomer(row.id);
      if (!res.ok) {
        toast.error(
          done === 0
            ? res.error
            : `Deleted ${done} of ${selected.length}, then stopped: ${res.error}`,
        );
        router.refresh();
        return { ok: false as const, error: res.error };
      }
      done++;
    }
    toast.success(`${done} client${done === 1 ? "" : "s"} deleted.`);
    router.refresh();
    return { ok: true as const };
  }

  /**
   * Ordered to match Create New Client KYC, section by section, so reading
   * across a row walks the same path as filling the form in.
   *
   * Company and Client Code lead regardless — a table needs its identifier
   * first, and the code is the key every other screen refers to. After that
   * the order is the form's own: Identity, Registration & Tax, the billing
   * city from Addresses, Commercial & Credit, then Export Details, with the
   * record's own Status and Created last since neither is a KYC field.
   *
   * Contacts, addresses and bank accounts are not here at all. Each has a
   * master of its own, which onboarding fills at the same time, and that is
   * the one place to read or correct them. City goes with them: it is part of
   * an address, not of the client.
   *
   * `defaultHidden` keeps the table readable while still carrying every
   * field — hidden ones stay searchable, tick on from the Columns menu, join
   * the CSV once ticked, and always appear in the row detail.
   */
  const text = (
    key: string,
    header: string,
    width: number,
    pick: (r: ClientMasterRow) => string | null,
  ): Column<ClientMasterRow> => ({
    key,
    header,
    width,
    defaultHidden: true,
    render: (r) => pick(r) || <Dash />,
    value: (r) => pick(r) ?? "",
  });

  /**
   * A column whose value comes off a master list — a dropdown in the cell.
   *
   * Same shape as `text` above and used the same way; the only difference is
   * that the cell can be changed where it sits. Every one of these is a field
   * the KYC form itself picks from a list, so the options here are that list,
   * read from `bulkOptions`.
   */
  const picker = (
    key: string,
    header: string,
    width: number,
    options: readonly string[],
    pick: (r: ClientMasterRow) => string | null,
  ): Column<ClientMasterRow> => ({
    key,
    header,
    width,
    defaultHidden: true,
    render: (r) => (
      <InlineSelect
        value={pick(r)}
        options={options}
        field={header}
        rowLabel={r.name}
        accent={KYC_ACCENT}
        accentSoft={KYC_ACCENT_SOFT}
        onSave={(next) => patch(r, { [key]: next ?? "" })}
      />
    ),
    value: (r) => pick(r) ?? "",
  });

  /**
   * A Yes/No column, as a dropdown.
   *
   * Not clearable: the column is a NOT NULL boolean, so "neither" is not one
   * of the answers — a blank one reads No because that is what the database
   * holds.
   */
  const yesNo = (
    key: string,
    header: string,
    width: number,
    pick: (r: ClientMasterRow) => boolean,
  ): Column<ClientMasterRow> => ({
    key,
    header,
    width,
    defaultHidden: true,
    render: (r) => (
      <InlineSelect
        value={pick(r) ? "Yes" : "No"}
        options={YES_NO}
        clearable={false}
        field={header}
        rowLabel={r.name}
        accent={KYC_ACCENT}
        accentSoft={KYC_ACCENT_SOFT}
        onSave={(next) => patch(r, { [key]: next === "Yes" })}
      />
    ),
    value: (r) => (pick(r) ? "Yes" : "No"),
  });

  const columns: Column<ClientMasterRow>[] = [
    /* ── Record identity ─────────────────────────────────────────────────── */
    {
      key: "name",
      header: "Company",
      width: 220,
      render: (r) => <strong className="text-ink-strong">{r.name}</strong>,
    },
    {
      key: "code",
      header: "Client Code",
      width: 110,
      render: (r) => (r.code ? <CodeCell>{r.code}</CodeCell> : <Dash />),
      value: (r) => r.code ?? "",
    },

    /* ── 1. Identity ─────────────────────────────────────────────────────── */
    {
      key: "gstin",
      header: "GSTIN",
      width: 150,
      render: (r) =>
        hasGstin(r) ? (
          <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 12.5 }}>
            {r.gstin}
          </span>
        ) : (
          <Dash />
        ),
      value: (r) => r.gstin ?? "",
    },
    text("reference", "Reference", 150, (r) => r.reference),
    {
      key: "salesRepName",
      header: "Sales Co-ordinator",
      width: 165,
      // The cell shows a name but the row stores an id, so the picker works
      // in names and hands back the id. A name no longer on the roster can
      // still be read here; it just isn't one of the options.
      render: (r) => (
        <InlineSelect
          value={r.salesRepName}
          options={salesNames}
          field="Sales Co-ordinator"
          rowLabel={r.name}
          accent={KYC_ACCENT}
          accentSoft={KYC_ACCENT_SOFT}
          onSave={(next) =>
            patch(r, { salesRepId: next ? (salesIdByName.get(next) ?? "") : "" })
          }
        />
      ),
      value: (r) => r.salesRepName ?? "",
    },
    {
      key: "grade",
      header: "Grade",
      width: 95,
      render: (r) => (
        <InlineSelect
          value={r.grade}
          options={GRADES}
          field="Grade"
          rowLabel={r.name}
          accent={KYC_ACCENT}
          accentSoft={KYC_ACCENT_SOFT}
          onSave={(next) => patch(r, { grade: next ?? "" })}
        />
      ),
      value: (r) => r.grade ?? "",
    },
    {
      key: "tags",
      header: "Tags",
      width: 180,
      // Tags have no master list — they are coined per client — so the menu
      // offers the ones already in use across the register. A brand new tag
      // is still added from the edit dialog, which takes typed ones.
      render: (r) => (
        <InlineMulti
          value={r.tags}
          options={tagSuggestions}
          label="Tags"
          field="Tags"
          rowLabel={r.name}
          accent={KYC_ACCENT}
          accentSoft={KYC_ACCENT_SOFT}
          onSave={(next) => patch(r, { tags: next.join(", ") })}
        />
      ),
      value: (r) => r.tags.join(", "),
    },
    {
      key: "customerTypes",
      header: "Customer Type",
      width: 200,
      render: (r) => (
        <InlineMulti
          value={r.customerTypes}
          options={bulkOptions.customerTypes}
          label="Customer Types"
          field="Customer Type"
          rowLabel={r.name}
          accent={KYC_ACCENT}
          accentSoft={KYC_ACCENT_SOFT}
          onSave={(next) => patch(r, { customerTypes: next.join(", ") })}
        />
      ),
      value: (r) => r.customerTypes.join(", "),
    },
    {
      key: "industryTypes",
      header: "Industry Type",
      width: 200,
      render: (r) => (
        <InlineMulti
          value={r.industryTypes}
          options={bulkOptions.industryTypes}
          label="Industry Types"
          field="Industry Type"
          rowLabel={r.name}
          accent={KYC_ACCENT}
          accentSoft={KYC_ACCENT_SOFT}
          onSave={(next) => patch(r, { industryTypes: next.join(", ") })}
        />
      ),
      value: (r) => r.industryTypes.join(", "),
    },
    {
      key: "products",
      header: "Product Types",
      width: 220,
      defaultHidden: true,
      // The one cell here that writes a child table rather than the client
      // row, so it has an action of its own — see `updateClientProducts`.
      render: (r) => (
        <InlineMulti
          value={r.products}
          options={bulkOptions.products}
          label="Product Types"
          field="Product Types"
          rowLabel={r.name}
          accent={KYC_ACCENT}
          accentSoft={KYC_ACCENT_SOFT}
          onSave={(next) => saveProducts(r, next)}
        />
      ),
      value: (r) => r.products.join(", "),
    },

    /* ── 2. Registration & Tax ───────────────────────────────────────────── */
    text("panNo", "PAN / IT No", 130, (r) => r.panNo),
    text("msmeUdyamNo", "MSME / Udyam No", 160, (r) => r.msmeUdyamNo),
    picker("gstRegistrationType", "GST Registration Type", 185, bulkOptions.gstRegistrationTypes, (r) => r.gstRegistrationType),
    picker("state", "State", 160, bulkOptions.states, (r) => r.state),
    text("tinNumber", "TIN No", 120, (r) => r.tinNumber),
    yesNo("testCertificateNeeded", "Test Certificate Needed", 185, (r) => r.testCertificateNeeded),
    text("website", "Website", 160, (r) => r.website),
    yesNo("tcsApplicable", "TCS Applicable", 150, (r) => r.tcsApplicable),


    /* ── 5. Commercial & Credit ──────────────────────────────────────────── */
    picker("paymentTerms", "Payment Terms", 175, bulkOptions.paymentTerms, (r) => r.paymentTerms),
    picker("freightCharges", "Freight Charges", 165, bulkOptions.freightCharges, (r) => r.freightCharges),
    {
      key: "creditDays",
      header: "Credit Days",
      width: 150,
      defaultHidden: true,
      // 0 is a real answer — cash on delivery — so it must not fall through
      // to the dash an unanswered field gets. The stepper carries that: null
      // reads as a dash, 0 reads as "0 days".
      render: (r) => (
        <InlineNumber
          value={r.creditDays}
          step={1}
          format={(n) => `${n} days`}
          field="Credit Days"
          rowLabel={r.name}
          onSave={(next) => patch(r, { creditDays: next === null ? "" : String(next) })}
        />
      ),
      value: (r) => (r.creditDays === null ? "" : String(r.creditDays)),
    },
    {
      key: "creditLimit",
      header: "Credit Limit",
      width: 175,
      // Type any figure; the steppers move it one at a time from wherever it
      // lands, so 10 goes 11, 12 and back 10, 9, 8. They are for the last
      // adjustment, not for reaching a number from zero.
      render: (r) => (
        <InlineNumber
          value={r.creditLimit === null ? null : Number(r.creditLimit)}
          step={1}
          format={formatInr}
          field="Credit Limit"
          rowLabel={r.name}
          onSave={(next) => patch(r, { creditLimit: next === null ? "" : String(next) })}
        />
      ),
      value: (r) => r.creditLimit ?? "",
    },
    picker("transporter", "Transporter", 160, bulkOptions.transporters, (r) => r.transporter),
    picker("quantityDeviation", "Quantity Deviation", 165, bulkOptions.quantityDeviations, (r) => r.quantityDeviation),
    text("otherReferences", "Other References", 160, (r) => r.otherReferences),
    text("notes", "Client Notes", 220, (r) => r.notes),

    /* ── 8. Export Details ───────────────────────────────────────────────── */
    // Export/Domestic keeps its data but gives up its column to Focused View
    // below, which is the flag people actually scan this table for. Still one
    // tick away in the Columns menu.
    {
      key: "trade",
      header: "Export",
      width: 120,
      defaultHidden: true,
      // The column reads Export/Domestic but the field behind it is the KYC
      // form's Export Yes/No, so the picker offers that and the Trade filter
      // keeps reading the same answer through `tradeOf`.
      render: (r) => (
        <InlineSelect
          value={r.exportClient?.trim() ? r.exportClient : null}
          options={YES_NO}
          placeholder="No"
          field="Export"
          rowLabel={r.name}
          accent={KYC_ACCENT}
          accentSoft={KYC_ACCENT_SOFT}
          onSave={(next) => patch(r, { exportClient: next ?? "" })}
        />
      ),
      value: (r) => tradeOf(r),
    },
    text("iecNumber", "IEC Code", 120, (r) => r.iecNumber),
    picker("currency", "Currency", 125, bulkOptions.currencies, (r) => r.currency),
    picker("country", "Country", 155, bulkOptions.countries, (r) => r.country),

    /* ── The record's own, not the form's ────────────────────────────────── */
    // 0086's Focused View flag: the shortlist of clients worth watching.
    //
    // A dropdown rather than the read-only pill it used to be. The pill was
    // deliberate once — a one-click toggle on a table row can move a client
    // on or off the list by accident — but a two-step menu is not a stray
    // click, and the flag was the one thing people came to this column to
    // change.
    {
      key: "focusedView",
      header: "Focused View",
      width: 150,
      // Yes / No, the same wording the Customer Master uses for this flag —
      // and a plain "No" rather than a dash, because not being on the list is
      // an answer, not a blank.
      render: (r) => (
        <InlineSelect
          value={r.focusedView ? "Yes" : "No"}
          options={YES_NO}
          clearable={false}
          field="Focused View"
          rowLabel={r.name}
          accent={KYC_ACCENT}
          accentSoft={KYC_ACCENT_SOFT}
          onSave={(next) => patch(r, { focusedView: next === "Yes" })}
        />
      ),
      value: (r) => (r.focusedView ? "Yes" : "No"),
    },
    {
      key: "isActive",
      header: "Status",
      width: 100,
      render: (r) => <StatusCell active={r.isActive} dormant={isDormant(r)} />,
      // Matches what the cell renders, so a search for "dormant" finds the
      // rows the Dormant filter shows and the CSV says the same thing.
      value: statusLabel,
    },
    {
      key: "createdAt",
      header: "Created",
      width: 110,
      render: (r) => formatDate(r.createdAt),
      value: (r) => formatDate(r.createdAt),
    },
  ];

  const filters: FilterDef<ClientMasterRow>[] = [
    {
      key: "focusedView",
      label: "Focused View",
      options: [
        { value: "yes", label: "On the list" },
        { value: "no", label: "Not on the list" },
      ],
      matches: (r, v) => (v === "yes" ? r.focusedView : !r.focusedView),
    },
    {
      key: "grade",
      label: "Grade",
      options: ["A", "B", "C"].map((g) => ({ value: g, label: g })),
      matches: (r, v) => r.grade === v,
    },
    {
      key: "salesRep",
      label: "Sales Co-ordinator",
      options: distinctFrom(clients, (r) => (r.salesRepName ? [r.salesRepName] : [])).map((n) => ({
        value: n,
        label: n,
      })),
      matches: (r, v) => r.salesRepName === v,
    },
    {
      key: "customerType",
      label: "Customer Type",
      options: distinctFrom(clients, (r) => r.customerTypes).map((t) => ({ value: t, label: t })),
      matches: (r, v) => r.customerTypes.includes(v),
    },
    {
      key: "industryType",
      label: "Industry",
      options: distinctFrom(clients, (r) => r.industryTypes).map((t) => ({ value: t, label: t })),
      matches: (r, v) => r.industryTypes.includes(v),
    },
    {
      key: "trade",
      label: "Trade",
      options: [
        { value: "Export", label: "Export" },
        { value: "Domestic", label: "Domestic" },
      ],
      matches: (r, v) => tradeOf(r) === v,
    },
    {
      /*
       * Status, with dormancy folded into it (0101). Options, default and
       * matcher all come from lib/masters/dormancy.ts, which the Customer
       * Master reads too — two views of one row cannot disagree about which
       * customers are on the register.
       */
      key: "status",
      label: "Status",
      defaultValue: STATUS_FILTER_DEFAULT,
      options: STATUS_FILTER_OPTIONS,
      matches: matchesStatusFilter,
    },
    {
      key: "gstin",
      label: "GSTIN",
      options: [
        { value: "with", label: "With GSTIN" },
        { value: "without", label: "Without GSTIN" },
      ],
      matches: (r, v) => (v === "with" ? hasGstin(r) : !hasGstin(r)),
    },
  ];

  const sorts: SortDef<ClientMasterRow>[] = [
    { value: "name", label: "Company A–Z", compare: (a, b) => a.name.localeCompare(b.name) },
    { value: "name_desc", label: "Company Z–A", compare: (a, b) => b.name.localeCompare(a.name) },
    { value: "newest", label: "Newest First", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
    { value: "oldest", label: "Oldest First", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
  ];

  const viewSwitch = <ViewSwitch view={view} onChange={setView} accent={KYC_ACCENT} />;

  if (view === "grid") {
    return (
      <ClientMasterGrid
        clients={clients}
        salesPeople={salesPeople}
        options={bulkOptions}
        toolbar={viewSwitch}
      />
    );
  }

  return (
    <>
      <DataTable
        rows={clients}
        columns={columns}
        filters={filters}
        sorts={sorts}
        title={title}
        tintHeader
        countNoun="clients"
        searchPlaceholder="Search company, contact, code…"
        csvName={csvName}
        exportLabel="CSV"
        // PDF + Excel sit beside the table's own CSV button. Both are plain
        // links to admin-only route handlers rather than client-side
        // generation: pdfkit is Node-only, and pulling the xlsx writer into
        // the browser bundle to build a sheet the server can already produce
        // would cost every visitor the download.
        //
        // Note these export the FULL onboarded register, not the currently
        // filtered/searched view — the filtering here is client-side, so the
        // server route has no way to see it. CSV remains the "what I'm
        // looking at right now" export.
        extraActions={
          <>
            <a
              href="/forms/client-kyc/export.xlsx"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-chip px-3 h-8 text-[12.5px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap transition-colors hover:border-hairline-strong hover:text-ink-strong"
              title="Download every onboarded client as a spreadsheet"
            >
              <FileSpreadsheet size={14} strokeWidth={2.3} className="shrink-0" />
              Excel
            </a>
            <a
              href="/forms/client-kyc/export.pdf"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-chip px-3 h-8 text-[12.5px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap transition-colors hover:border-hairline-strong hover:text-ink-strong"
              title="Download the client KYC register as a PDF"
            >
              <FileText size={14} strokeWidth={2.3} className="shrink-0" />
              PDF
            </a>
          </>
        }
        selectable
        rowDetail
        // Sits beside Export / View details / Delete in the selection bar.
        // Parking a customer is a bulk job — you notice a dozen dead accounts
        // at once, not one — so it belongs where the ticks already are.
        selectionActions={({ rows: selected, clear }) => {
          const reactivating = selected.every(isDormant);
          return (
            <button
              type="button"
              disabled={pending}
              onClick={() => toggleDormant(selected, clear)}
              title={
                reactivating
                  ? "Put these customers back on the register"
                  : "Park these customers — they leave this list, the Customer Master and the three directories"
              }
              className="inline-flex items-center gap-1.5 rounded-pill px-3 h-8 text-[13px] font-semibold text-ink-soft bg-surface-card border border-hairline disabled:opacity-50 whitespace-nowrap"
            >
              {reactivating ? (
                <Sunrise size={14} strokeWidth={2.3} className="shrink-0" />
              ) : (
                <MoonStar size={14} strokeWidth={2.3} className="shrink-0" />
              )}
              {reactivating ? "Reactivate" : "Set Dormant"}
            </button>
          );
        }}
        onBulkDelete={removeSelected}
        deleteNoun="client"
        // Edits the client where it sits. This used to push to
        // /masters/customers — a different screen over the same table,
        // showing a different subset of it — so fixing a KYC field meant
        // leaving the Client Master to find a form that did not have it.
        onEdit={(row) => setEditing(row)}
        // Deactivating is a one-field edit, so it reuses the same action the
        // dialog saves through rather than a second write path that could
        // drift from it. Only this table offers it — contacts, addresses and
        // bank accounts carry no active flag.
        onToggleActive={(row) =>
          void updateClientMasterRecord(row.id, {
            ...fromEditValues(toEditValues(row)),
            isActive: !row.isActive,
          })
            .then((res) => {
              if (res.ok) {
                toast.success(`${row.name} ${row.isActive ? "deactivated" : "activated"}.`);
                router.refresh();
              } else {
                toast.error(res.error);
              }
            })
            .catch(() => toast.error("Couldn't reach the server. Try again in a moment."))
        }
        rowDetailTitle={(r) => r.name}
        onNew={() => router.push("/forms/client-kyc/new")}
        newLabel="New client"
        accent={KYC_ACCENT}
        fullscreen
        // In the HEADER row, not the filter band. It creates rows, the same
        // family as New client — and it was the one control that pushed
        // Client Master's seven filters onto a second line.
        //
        // A typeable sheet rather than the old file-only upload: a bad row
        // used to mean reopening Excel and re-uploading everything, and now
        // means fixing the cell that is flagged.
        headerActions={
          <>
            {viewSwitch}
            <ClientBulkImport options={bulkOptions} />
          </>
        }
        emptyTitle="No clients yet."
        emptySub="Onboard one with New client, or bring your existing list in with Bulk Import."
      />

      {editing && (
        <RecordEditDialog
          title={`Edit ${editing.name}`}
          fields={editFields(salesPeople, bulkOptions, tagSuggestions)}
          initial={toEditValues(editing)}
          onSave={(values) => updateClientMasterRecord(editing.id, fromEditValues(values))}
          onClose={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
