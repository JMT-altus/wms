"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CustomerRow } from "@/lib/queries/master-data";
import { formatInr } from "@/lib/format";
import {
  deleteMasterCustomer,
  saveMasterCustomer,
} from "@/app/(masters-module)/masters/actions";
import {
  DataTable,
  Dash,
  Pill,
  type Column,
  type SortDef,
} from "@/components/admin/master/data-table";
import {
  CancelButton,
  Field,
  SaveButton,
  SelectInput,
  TextInput,
  Toggle,
} from "@/components/admin/master/drawer";
import { CodeCell, RowMenu, StatusCell } from "./row-menu";
import { MastersDialog } from "./masters-dialog";
import { MASTERS_GRADIENT } from "./theme";
import { BulkUpload } from "./bulk-upload";

const ACCENT = MASTERS_GRADIENT;
const FORM_ID = "masters-customer-form";

export function CustomerMasterManager({
  customers,
  categoryOptions,
}: {
  customers: CustomerRow[];
  /** Active options from the admin-managed `customer_category` list. */
  categoryOptions: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<CustomerRow | null | "new">(null);
  const [pending, start] = React.useTransition();

  const columns: Column<CustomerRow>[] = [
    {
      key: "code",
      header: "Code",
      render: (r) => (r.code ? <CodeCell>{r.code}</CodeCell> : <Dash />),
      width: 160,
    },
    {
      key: "name",
      header: "Customer",
      render: (r) => <strong className="text-ink-strong">{r.name}</strong>,
    },
    {
      key: "customerCategory",
      header: "Customer Category",
      render: (r) => (r.customerCategory ? <Pill tone="purple">{r.customerCategory}</Pill> : <Dash />),
      value: (r) => r.customerCategory ?? "",
    },
    {
      key: "creditLimit",
      header: "Credit Limit",
      render: (r) => (r.creditLimit ? formatInr(Number(r.creditLimit)) : <Dash />),
      value: (r) => r.creditLimit ?? "",
    },
    {
      key: "creditPeriodDays",
      header: "Credit Period",
      render: (r) =>
        r.creditPeriodDays != null ? `${r.creditPeriodDays} Day${r.creditPeriodDays === 1 ? "" : "s"}` : <Dash />,
      value: (r) => r.creditPeriodDays ?? "",
    },
    {
      key: "focusedView",
      header: "Focused View",
      render: (r) =>
        r.focusedView ? <Pill tone="cyan">Yes</Pill> : <span className="text-ink-subtle">No</span>,
      value: (r) => (r.focusedView ? "Yes" : "No"),
    },

    /* Everything Create New Client KYC writes to this same row.
     *
     * The Client Master and this screen are two views of `customer_masters`,
     * so a field the KYC form fills in and this table cannot show is a field
     * that looks lost. Contacts, addresses and bank accounts are excluded —
     * each has a master of its own and does not belong repeated here.
     *
     * Hidden by default to keep the table readable — still searchable, one
     * tick away in the Columns menu, in the CSV once ticked, and always
     * listed in the row detail. Same order as the KYC form. */
    ...([
      ["customerTypes", "Customer Type", 150, (r) => r.customerTypes.join(", ")],
      ["industryTypes", "Industry Type", 150, (r) => r.industryTypes.join(", ")],
      ["tags", "Tags", 130, (r) => r.tags.join(", ")],
      ["reference", "Reference", 150, (r) => r.reference],
      ["panNo", "PAN / IT No", 130, (r) => r.panNo],
      ["msmeUdyamNo", "MSME / Udyam No", 160, (r) => r.msmeUdyamNo],
      ["gstRegistrationType", "GST Registration Type", 160, (r) => r.gstRegistrationType],
      ["tinNumber", "TIN No", 120, (r) => r.tinNumber],
      ["website", "Website", 160, (r) => r.website],
      ["paymentTerms", "Payment Terms", 150, (r) => r.paymentTerms],
      ["freightCharges", "Freight Charges", 140, (r) => r.freightCharges],
      ["transporter", "Transporter", 130, (r) => r.transporter],
      ["quantityDeviation", "Quantity Deviation", 140, (r) => r.quantityDeviation],
      ["exportClient", "Export", 100, (r) => r.exportClient],
      ["iecNumber", "IEC Code", 120, (r) => r.iecNumber],
      ["currency", "Currency", 90, (r) => r.currency],
      ["country", "Country", 110, (r) => r.country],
      ["otherReferences", "Other References", 160, (r) => r.otherReferences],
      ["notes", "Client Notes", 220, (r) => r.notes],
      ["state", "State", 130, (r) => r.state],
      ["gstin", "GSTIN", 150, (r) => r.gstin],
      ["tallyGroup", "Tally Group", 130, (r) => r.tallyGroup],
    ] as [string, string, number, (r: CustomerRow) => string | null][]).map(
      ([key, header, width, pick]) => ({
        key,
        header,
        width,
        defaultHidden: true,
        render: (r: CustomerRow) => pick(r) || <Dash />,
        value: (r: CustomerRow) => pick(r) ?? "",
      } satisfies Column<CustomerRow>),
    ),
    {
      key: "testCertificateNeeded",
      header: "Test Certificate Needed",
      width: 165,
      defaultHidden: true,
      render: (r) => (r.testCertificateNeeded ? "Yes" : "No"),
      value: (r) => (r.testCertificateNeeded ? "Yes" : "No"),
    },
    {
      key: "tcsApplicable",
      header: "TCS Applicable",
      width: 130,
      defaultHidden: true,
      render: (r) => (r.tcsApplicable ? "Yes" : "No"),
      value: (r) => (r.tcsApplicable ? "Yes" : "No"),
    },

    {
      key: "isActive",
      header: "Status",
      render: (r) => <StatusCell active={r.isActive} />,
      value: (r) => (r.isActive ? "Active" : "Inactive"),
      width: 110,
    },
  ];

  const sorts: SortDef<CustomerRow>[] = [
    { value: "newest", label: "Newest First", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
    { value: "oldest", label: "Oldest First", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
    { value: "name", label: "Name A–Z", compare: (a, b) => a.name.localeCompare(b.name) },
    { value: "name_desc", label: "Name Z–A", compare: (a, b) => b.name.localeCompare(a.name) },
  ];

  // Derived live from the rows on every render — never a stored/hardcoded
  // count, so it moves the instant a customer's Focused View flag changes.
  const focusedCount = customers.filter((c) => c.focusedView).length;

  function remove(row: CustomerRow) {
    if (!confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    start(async () => {
      const res = await deleteMasterCustomer(row.id);
      if (res.ok) toast.success("Customer deleted.");
      else toast.error(res.error);
    });
  }

  return (
    <>
      <DataTable
        rows={customers}
        columns={columns}
        title="Customer Master"
        sorts={sorts}
        tintHeader
        exportLabel="Export to Excel"
        csvName="customer-master"
        searchPlaceholder="Search customers"
        // New customers are created through Client KYC, not the narrow dialog
        // this screen edits with. Both write the same `customer_masters` row,
        // but the dialog only covers a dozen fields — a client created here
        // would be missing its contacts, addresses, bank accounts and half its
        // registration detail, and would land in the Client Master looking
        // complete. The KYC form is the one path that collects all of it.
        //
        // The dialog stays for EDITING an existing row, which is a different
        // job: correcting a field on a record that already has the rest.
        onNew={() => router.push("/forms/client-kyc/new")}
        newLabel="New Client"
        accent={ACCENT}
        fullscreen
        extraActions={
          <>
            <span
              title="Customers with Add to Focused View List = Yes"
              className="inline-flex items-center gap-1.5 rounded-pill px-3 h-8 text-[13px] font-semibold whitespace-nowrap"
              style={{
                background: "color-mix(in srgb, var(--color-cyan) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-cyan) 30%, transparent)",
                color: "var(--color-cyan-deep)",
              }}
            >
              Focused View — {focusedCount}
            </span>
            <BulkUpload target="customers" label="customers" />
          </>
        }
        filters={[
          {
            key: "category",
            label: "Customer Category",
            options: categoryOptions.map((c) => ({ value: c, label: c })),
            matches: (r, v) => r.customerCategory === v,
          },
          {
            key: "focusedView",
            label: "Focused View",
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
            matches: (r, v) => (v === "yes" ? r.focusedView : !r.focusedView),
          },
        ]}
        emptyTitle="No customers yet."
        emptySub="Add one with New Customer, or bring your existing list in with Bulk Upload."
        actions={(row) => (
          <RowMenu
            label={row.name}
            disabled={pending}
            onEdit={() => setEditing(row)}
            onDelete={() => remove(row)}
          />
        )}
      />

      {editing !== null && (
        <CustomerForm
          row={editing === "new" ? null : editing}
          categoryOptions={categoryOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CustomerForm({
  row,
  categoryOptions,
  onClose,
}: {
  row: CustomerRow | null;
  categoryOptions: string[];
  onClose: () => void;
}) {
  const [f, setF] = React.useState({
    name: row?.name ?? "",
    customerCategory: row?.customerCategory ?? "",
    // Numbers live as strings in form state (same pattern as the SKU form's
    // List rate) — an empty input has to stay "", not 0.
    creditLimit: row?.creditLimit ?? "",
    creditPeriodDays: row?.creditPeriodDays != null ? String(row.creditPeriodDays) : "",
    focusedView: row?.focusedView ?? false,
    // Purchase pattern, Sensitivity and Salesperson no longer have inputs on
    // this form (removed on request) — carried through unedited so saving a
    // customer here can't silently blank out a value set elsewhere (bulk
    // upload or Master Setup's fuller form).
    purchasePattern: row?.purchasePattern ?? null,
    sensitivity: row?.sensitivity ?? null,
    salesRepId: row?.salesRepId ?? null,
    isActive: row?.isActive ?? true,
  });
  const [pending, start] = React.useTransition();
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveMasterCustomer(row?.id ?? null, {
        ...f,
        creditLimit: f.creditLimit === "" ? null : f.creditLimit,
        creditPeriodDays: f.creditPeriodDays === "" ? null : f.creditPeriodDays,
      });
      if (res.ok) {
        toast.success(row ? "Customer updated." : "Customer added.");
        onClose();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <MastersDialog
      open
      width={640}
      title={row ? "Edit customer" : "New customer"}
      subtitle="Name is required. Everything else can be left blank until you know."
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} accent={ACCENT} form={FORM_ID}>
            {row ? "Save changes" : "Add customer"}
          </SaveButton>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="grid gap-4">
        <Field label="Customer name" required>
          <TextInput
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Shakti Engineering Works"
            autoFocus
            required
            maxLength={200}
          />
        </Field>

        <Field
          label="Customer code"
          hint={
            row
              ? "Assigned automatically. Existing codes never change."
              : "Assigned automatically when you save."
          }
        >
          <TextInput
            value={row?.code ?? "Assigned automatically on save"}
            disabled
            readOnly
          />
        </Field>

        <Field
          label="Customer category"
          hint="What the business IS. Manage these options in Master Setup → System Libraries — no developer needed."
        >
          <SelectInput
            value={f.customerCategory}
            onChange={(e) => set("customerCategory", e.target.value)}
          >
            <option value="">— not categorised —</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectInput>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Credit limit" hint="Maximum credit allowed, in ₹.">
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={f.creditLimit}
              onChange={(e) => set("creditLimit", e.target.value)}
            />
          </Field>

          <Field label="Credit period" hint="Days of credit allowed, e.g. 30.">
            <TextInput
              type="number"
              min="0"
              step="1"
              value={f.creditPeriodDays}
              onChange={(e) => set("creditPeriodDays", e.target.value)}
            />
          </Field>
        </div>

        <div className="flex items-center gap-6">
          <Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Active" />
          <Toggle
            checked={f.focusedView}
            onChange={(v) => set("focusedView", v)}
            label="Add to Focused View List"
          />
        </div>
      </form>
    </MastersDialog>
  );
}
