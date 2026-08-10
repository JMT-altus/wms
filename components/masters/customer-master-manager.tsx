"use client";
import * as React from "react";
import { toast } from "sonner";
import {
  CUSTOMER_SENSITIVITIES,
  CUSTOMER_SENSITIVITY_LABELS,
  PURCHASE_PATTERNS,
  PURCHASE_PATTERN_LABELS,
  type CustomerSensitivity,
  type PurchasePattern,
} from "@/db/enums";
import type { CustomerRow } from "@/lib/queries/master-data";
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

const SENSITIVITY_TONE: Record<CustomerSensitivity, string> = {
  cost_sensitive: "rose",
  neutral: "slate",
  loyal: "teal",
};

export function CustomerMasterManager({
  customers,
  salesReps,
  categoryOptions,
}: {
  customers: CustomerRow[];
  salesReps: { id: string; name: string }[];
  /** Active options from the admin-managed `customer_category` list. */
  categoryOptions: string[];
}) {
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
      header: "Category",
      render: (r) => (r.customerCategory ? <Pill tone="purple">{r.customerCategory}</Pill> : <Dash />),
      value: (r) => r.customerCategory ?? "",
    },
    {
      key: "purchasePattern",
      header: "Purchase pattern",
      render: (r) =>
        r.purchasePattern ? <Pill tone="blue">{PURCHASE_PATTERN_LABELS[r.purchasePattern]}</Pill> : <Dash />,
      value: (r) => (r.purchasePattern ? PURCHASE_PATTERN_LABELS[r.purchasePattern] : ""),
    },
    {
      key: "sensitivity",
      header: "Sensitivity",
      render: (r) =>
        r.sensitivity ? (
          <Pill tone={SENSITIVITY_TONE[r.sensitivity]}>{CUSTOMER_SENSITIVITY_LABELS[r.sensitivity]}</Pill>
        ) : (
          <Dash />
        ),
      value: (r) => (r.sensitivity ? CUSTOMER_SENSITIVITY_LABELS[r.sensitivity] : ""),
    },
    {
      key: "salesRepName",
      header: "Salesperson",
      // The one gap worth shouting about: allocation is the point of this
      // screen, and bulk-uploaded rows arrive without a rep.
      render: (r) => r.salesRepName ?? <Pill tone="red">Unassigned</Pill>,
      value: (r) => r.salesRepName ?? "Unassigned",
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
    {
      value: "rep",
      label: "Salesperson",
      // Unassigned first: this sort exists to find the gaps, not to hide them.
      compare: (a, b) =>
        (a.salesRepName ?? "").localeCompare(b.salesRepName ?? "") || a.name.localeCompare(b.name),
    },
  ];

  const unassigned = customers.filter((c) => !c.salesRepId).length;

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
      {unassigned > 0 && (
        <div
          className="mb-4 rounded-chip px-4 py-3 font-semibold"
          style={{
            fontSize: 14,
            background: "color-mix(in srgb, var(--color-amber) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-amber) 32%, transparent)",
            color: "var(--color-amber-deep)",
          }}
        >
          {unassigned} customer{unassigned === 1 ? " has" : "s have"} no salesperson allocated. Filter
          by &ldquo;Unassigned&rdquo; to fix them.
        </div>
      )}

      <DataTable
        rows={customers}
        columns={columns}
        title="Customer Master"
        sorts={sorts}
        tintHeader
        exportLabel="Export to Excel"
        csvName="customer-master"
        searchPlaceholder="Search customers"
        onNew={() => setEditing("new")}
        newLabel="New Customer"
        accent={ACCENT}
        extraActions={<BulkUpload target="customers" label="customers" />}
        filters={[
          {
            key: "category",
            label: "Category",
            options: categoryOptions.map((c) => ({ value: c, label: c })),
            matches: (r, v) => r.customerCategory === v,
          },
          {
            key: "pattern",
            label: "Pattern",
            options: PURCHASE_PATTERNS.map((p) => ({ value: p, label: PURCHASE_PATTERN_LABELS[p] })),
            matches: (r, v) => r.purchasePattern === v,
          },
          {
            key: "sensitivity",
            label: "Sensitivity",
            options: CUSTOMER_SENSITIVITIES.map((s) => ({
              value: s,
              label: CUSTOMER_SENSITIVITY_LABELS[s],
            })),
            matches: (r, v) => r.sensitivity === v,
          },
          {
            key: "rep",
            label: "Salesperson",
            options: [
              { value: "__none", label: "Unassigned" },
              ...salesReps.map((s) => ({ value: s.id, label: s.name })),
            ],
            matches: (r, v) => (v === "__none" ? !r.salesRepId : r.salesRepId === v),
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
          salesReps={salesReps}
          categoryOptions={categoryOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CustomerForm({
  row,
  salesReps,
  categoryOptions,
  onClose,
}: {
  row: CustomerRow | null;
  salesReps: { id: string; name: string }[];
  categoryOptions: string[];
  onClose: () => void;
}) {
  const [f, setF] = React.useState({
    name: row?.name ?? "",
    code: row?.code ?? "",
    customerCategory: row?.customerCategory ?? "",
    purchasePattern: (row?.purchasePattern ?? "") as PurchasePattern | "",
    sensitivity: (row?.sensitivity ?? "") as CustomerSensitivity | "",
    salesRepId: row?.salesRepId ?? "",
    isActive: row?.isActive ?? true,
  });
  const [pending, start] = React.useTransition();
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveMasterCustomer(row?.id ?? null, {
        ...f,
        // "" is the placeholder option, not a value — send null so the column
        // stays genuinely blank rather than storing an empty string.
        purchasePattern: f.purchasePattern === "" ? null : f.purchasePattern,
        sensitivity: f.sensitivity === "" ? null : f.sensitivity,
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
      subtitle="Name and salesperson are required. Classifications can be left blank until you know."
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

        <Field label="Code" hint="Your internal or Tally ledger code, if you use one.">
          <TextInput
            value={f.code}
            onChange={(e) => set("code", e.target.value)}
            maxLength={60}
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

        <Field label="Purchasing pattern" hint="How often they buy.">
          <SelectInput
            value={f.purchasePattern}
            onChange={(e) => set("purchasePattern", e.target.value)}
          >
            <option value="">— not set —</option>
            {PURCHASE_PATTERNS.map((p) => (
              <option key={p} value={p}>
                {PURCHASE_PATTERN_LABELS[p]}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Sensitivity / behaviour" hint="Why they buy from us.">
          <SelectInput value={f.sensitivity} onChange={(e) => set("sensitivity", e.target.value)}>
            <option value="">— not set —</option>
            {CUSTOMER_SENSITIVITIES.map((s) => (
              <option key={s} value={s}>
                {CUSTOMER_SENSITIVITY_LABELS[s]}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Salesperson" required hint="Every customer needs an owner.">
          <SelectInput
            value={f.salesRepId}
            onChange={(e) => set("salesRepId", e.target.value)}
            required
          >
            <option value="">— pick a salesperson —</option>
            {salesReps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Active" />
      </form>
    </MastersDialog>
  );
}
