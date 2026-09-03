"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ClientMasterRow } from "@/lib/queries/client-kyc";
import { formatInr } from "@/lib/format";
import { deleteMasterCustomer } from "@/app/(masters-module)/masters/actions";
import { updateClientMasterRecord } from "@/app/(forms-module)/forms/client-kyc/actions";
import { RecordEditDialog, type EditField, type EditValues } from "./kyc/record-edit-dialog";
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
import { FileSpreadsheet, FileText } from "lucide-react";
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
 * Comma-separated text is how the dialog edits the three list fields.
 *
 * Customer Type, Industry Type and Tags are pill pickers on the KYC form,
 * fed from master lists. Rebuilding those pickers here would be a second
 * place for them to drift; a comma-separated box edits the same values, and
 * anyone adding a genuinely new option should be doing it in the form or the
 * library screen that owns the list.
 */
const listToText = (v: string[]) => v.join(", ");
const textToList = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** The dialog's field list, in the same order as the table's columns. */
function editFields(salesPeople: EmployeeOption[]): EditField[] {
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
      options: ["A", "B", "C"].map((g) => ({ value: g, label: g })),
    },
    { key: "customerTypes", label: "Customer Type", span: 3, placeholder: "Comma separated" },
    { key: "industryTypes", label: "Industry Type", span: 2, placeholder: "Comma separated" },
    { key: "tags", label: "Tags", span: 2, placeholder: "Comma separated" },

    /* Registration & Tax */
    { key: "panNo", label: "PAN / IT No", span: 2, maxLength: 20 },
    { key: "msmeUdyamNo", label: "MSME / Udyam No", span: 2, maxLength: 40 },
    { key: "gstRegistrationType", label: "GST Registration Type", span: 2, maxLength: 60 },
    { key: "state", label: "State", span: 2, maxLength: 120 },
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
    { key: "paymentTerms", label: "Payment Terms", span: 2, maxLength: 120 },
    { key: "freightCharges", label: "Freight Charges", span: 2, maxLength: 120 },
    { key: "creditDays", label: "Credit Days", span: 2, inputMode: "numeric" },
    { key: "creditLimit", label: "Credit Limit", span: 2, inputMode: "numeric" },
    { key: "transporter", label: "Transporter", span: 2, maxLength: 160 },
    { key: "quantityDeviation", label: "Quantity Deviation", span: 2, maxLength: 60 },
    { key: "otherReferences", label: "Other References", span: 4, maxLength: 400 },
    { key: "notes", label: "Client Notes", type: "textarea", span: 4, maxLength: 2000 },

    /* Export Details */
    { key: "exportClient", label: "Export", type: "select", span: 2, options: YES_NO_OPTIONS },
    { key: "iecNumber", label: "IEC Code", span: 2, maxLength: 40 },
    { key: "currency", label: "Currency", span: 2, maxLength: 20 },
    { key: "country", label: "Country", span: 2, maxLength: 80 },

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

const YES_NO_OPTIONS = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

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
}: {
  clients: ClientMasterRow[];
  /** Fills the edit dialog's Sales Co-ordinator picker. */
  salesPeople: EmployeeOption[];
  /** The master lists behind Bulk Import's dropdown cells. */
  bulkOptions: ClientBulkOptions;
}) {
  const [editing, setEditing] = React.useState<ClientMasterRow | null>(null);
  const router = useRouter();

  /**
   * Bulk delete from the selection bar.
   *
   * Sequential rather than parallel: `deleteMasterCustomer` revalidates on
   * every call, and firing fifty of those at once floods the pool for no
   * gain on a list this size. Stops at the first failure and says how far it
   * got, so a partial delete is never reported as a clean one.
   */
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
    render: (r) => (pick(r) ? "Yes" : "No"),
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
      width: 130,
      render: (r) => r.salesRepName ?? <Dash />,
      value: (r) => r.salesRepName ?? "",
    },
    {
      key: "grade",
      header: "Grade",
      width: 70,
      render: (r) =>
        r.grade ? (
          <span
            className="inline-grid place-items-center rounded-full font-bold"
            style={{ width: 22, height: 22, fontSize: 11, background: KYC_ACCENT_SOFT, color: KYC_ACCENT }}
          >
            {r.grade}
          </span>
        ) : (
          <Dash />
        ),
      value: (r) => r.grade ?? "",
    },
    {
      key: "tags",
      header: "Tags",
      width: 130,
      render: (r) =>
        r.tags.length ? (
          <span className="flex flex-wrap gap-1">
            {r.tags.map((t) => (
              <span
                key={t}
                className="inline-flex rounded-pill px-1.5 py-0.5 font-semibold"
                style={{ fontSize: 10.5, background: KYC_ACCENT_SOFT, color: KYC_ACCENT }}
              >
                {t}
              </span>
            ))}
          </span>
        ) : (
          <Dash />
        ),
      value: (r) => r.tags.join(", "),
    },
    {
      key: "customerTypes",
      header: "Customer Type",
      width: 150,
      render: (r) => (r.customerTypes.length ? r.customerTypes.join(", ") : <Dash />),
      value: (r) => r.customerTypes.join(", "),
    },
    {
      key: "industryTypes",
      header: "Industry Type",
      width: 150,
      render: (r) => (r.industryTypes.length ? r.industryTypes.join(", ") : <Dash />),
      value: (r) => r.industryTypes.join(", "),
    },
    text("products", "Product Types", 180, (r) => r.products.join(", ")),

    /* ── 2. Registration & Tax ───────────────────────────────────────────── */
    text("panNo", "PAN / IT No", 130, (r) => r.panNo),
    text("msmeUdyamNo", "MSME / Udyam No", 160, (r) => r.msmeUdyamNo),
    text("gstRegistrationType", "GST Registration Type", 160, (r) => r.gstRegistrationType),
    text("state", "State", 130, (r) => r.state),
    text("tinNumber", "TIN No", 120, (r) => r.tinNumber),
    yesNo("testCertificateNeeded", "Test Certificate Needed", 165, (r) => r.testCertificateNeeded),
    text("website", "Website", 160, (r) => r.website),
    yesNo("tcsApplicable", "TCS Applicable", 130, (r) => r.tcsApplicable),


    /* ── 5. Commercial & Credit ──────────────────────────────────────────── */
    text("paymentTerms", "Payment Terms", 150, (r) => r.paymentTerms),
    text("freightCharges", "Freight Charges", 140, (r) => r.freightCharges),
    {
      key: "creditDays",
      header: "Credit Days",
      width: 110,
      defaultHidden: true,
      // 0 is a real answer — cash on delivery — so it must not fall through
      // to the dash an unanswered field gets.
      render: (r) => (r.creditDays === null ? <Dash /> : `${r.creditDays} days`),
      value: (r) => (r.creditDays === null ? "" : String(r.creditDays)),
    },
    {
      key: "creditLimit",
      header: "Credit Limit",
      width: 110,
      render: (r) => (r.creditLimit ? formatInr(Number(r.creditLimit)) : <Dash />),
      value: (r) => r.creditLimit ?? "",
    },
    text("transporter", "Transporter", 130, (r) => r.transporter),
    text("quantityDeviation", "Quantity Deviation", 140, (r) => r.quantityDeviation),
    text("otherReferences", "Other References", 160, (r) => r.otherReferences),
    text("notes", "Client Notes", 220, (r) => r.notes),

    /* ── 8. Export Details ───────────────────────────────────────────────── */
    // Export/Domestic keeps its data but gives up its column to Focused View
    // below, which is the flag people actually scan this table for. Still one
    // tick away in the Columns menu.
    {
      key: "trade",
      header: "Export",
      width: 100,
      defaultHidden: true,
      render: (r) => {
        const t = tradeOf(r);
        return t === "Export" ? (
          <span
            className="inline-flex rounded-pill px-2 py-0.5 font-semibold"
            style={{ fontSize: 11.5, background: KYC_ACCENT_SOFT, color: KYC_ACCENT }}
          >
            Export
          </span>
        ) : (
          <span className="text-ink-muted" style={{ fontSize: 13 }}>
            Domestic
          </span>
        );
      },
      value: (r) => tradeOf(r),
    },
    text("iecNumber", "IEC Code", 120, (r) => r.iecNumber),
    text("currency", "Currency", 90, (r) => r.currency),
    text("country", "Country", 110, (r) => r.country),

    /* ── The record's own, not the form's ────────────────────────────────── */
    // 0086's Focused View flag: the shortlist of clients worth watching.
    // Read-only here — it is set from the Edit dialog, alongside Active, so
    // the two flags are changed the same way and a stray click on a table
    // row can never silently move a client on or off the list.
    {
      key: "focusedView",
      header: "Focused View",
      width: 120,
      // Yes / No, the same wording the Customer Master uses for this flag —
      // and a plain "No" rather than a dash, because not being on the list is
      // an answer, not a blank.
      render: (r) =>
        r.focusedView ? (
          <span
            className="inline-flex rounded-pill px-2 py-0.5 font-semibold"
            style={{ fontSize: 11.5, background: KYC_ACCENT_SOFT, color: KYC_ACCENT }}
          >
            Yes
          </span>
        ) : (
          <span className="text-ink-subtle" style={{ fontSize: 13 }}>
            No
          </span>
        ),
      value: (r) => (r.focusedView ? "Yes" : "No"),
    },
    {
      key: "isActive",
      header: "Status",
      width: 100,
      render: (r) => <StatusCell active={r.isActive} />,
      value: (r) => (r.isActive ? "Active" : "Inactive"),
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
      key: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
      matches: (r, v) => (v === "active" ? r.isActive : !r.isActive),
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

  return (
    <>
      <DataTable
        rows={clients}
        columns={columns}
        filters={filters}
        sorts={sorts}
        title="Client Master"
        tintHeader
        countNoun="clients"
        searchPlaceholder="Search company, contact, code…"
        csvName="client-master"
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
        headerActions={<ClientBulkImport options={bulkOptions} />}
        emptyTitle="No clients yet."
        emptySub="Onboard one with New client, or bring your existing list in with Bulk Import."
      />

      {editing && (
        <RecordEditDialog
          title={`Edit ${editing.name}`}
          fields={editFields(salesPeople)}
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
