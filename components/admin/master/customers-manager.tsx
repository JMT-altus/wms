"use client";
import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CUSTOMER_SENSITIVITIES,
  CUSTOMER_SENSITIVITY_LABELS,
  PURCHASE_PATTERNS,
  PURCHASE_PATTERN_LABELS,
  VOLUME_CLASSES,
  VOLUME_CLASS_LABELS,
  type CustomerSensitivity,
  type PurchasePattern,
  type VolumeClass,
} from "@/db/enums";
import type { CustomerRow } from "@/lib/queries/master-data";
import { deleteCustomer, saveCustomer } from "@/app/(masters)/master-setup/actions";
import { DataTable, Dash, Pill, type Column } from "./data-table";
import {
  CancelButton,
  Drawer,
  Field,
  RowBtn,
  SaveButton,
  SelectInput,
  TextArea,
  TextInput,
  Toggle,
} from "./drawer";

const CLASS_TONE: Record<VolumeClass, string> = { A: "green", B: "amber", C: "slate" };
const SENSITIVITY_TONE: Record<CustomerSensitivity, string> = {
  cost_sensitive: "rose",
  neutral: "slate",
  loyal: "teal",
};

export function CustomersManager({
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
    { key: "name", header: "Customer", render: (r) => <strong className="text-ink-strong">{r.name}</strong> },
    { key: "code", header: "Code" },
    {
      key: "customerCategory",
      header: "Category",
      render: (r) => (r.customerCategory ? <Pill tone="purple">{r.customerCategory}</Pill> : <Dash />),
      value: (r) => r.customerCategory ?? "",
    },
    {
      key: "salesRepName",
      header: "Sales rep",
      // A customer with no rep is the one gap worth shouting about — the brief
      // makes rep assignment mandatory, and legacy imports arrive without one.
      render: (r) =>
        r.salesRepName ?? <Pill tone="red">Unassigned</Pill>,
      value: (r) => r.salesRepName ?? "Unassigned",
    },
    {
      key: "volumeClass",
      header: "Class",
      render: (r) => (r.volumeClass ? <Pill tone={CLASS_TONE[r.volumeClass]}>{r.volumeClass}</Pill> : <Dash />),
      value: (r) => r.volumeClass ?? "",
    },
    {
      key: "purchasePattern",
      header: "Pattern",
      render: (r) =>
        r.purchasePattern ? <Pill tone="blue">{PURCHASE_PATTERN_LABELS[r.purchasePattern]}</Pill> : <Dash />,
      value: (r) => (r.purchasePattern ? PURCHASE_PATTERN_LABELS[r.purchasePattern] : ""),
    },
    {
      key: "sensitivity",
      header: "Behaviour",
      render: (r) =>
        r.sensitivity ? (
          <Pill tone={SENSITIVITY_TONE[r.sensitivity]}>{CUSTOMER_SENSITIVITY_LABELS[r.sensitivity]}</Pill>
        ) : (
          <Dash />
        ),
      value: (r) => (r.sensitivity ? CUSTOMER_SENSITIVITY_LABELS[r.sensitivity] : ""),
    },
    { key: "city", header: "City" },
    { key: "tallyGroup", header: "Tally group" },
  ];

  const unassigned = customers.filter((c) => !c.salesRepId).length;

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
          {unassigned} customer{unassigned === 1 ? " has" : "s have"} no sales rep assigned. Filter by
          &ldquo;Unassigned&rdquo; below to fix them.
        </div>
      )}

      <DataTable
        rows={customers}
        columns={columns}
        csvName="customers"
        searchPlaceholder="Search customers…"
        onNew={() => setEditing("new")}
        newLabel="New Customer"
        emptyTitle="No customers yet."
        emptySub="Add one here, or bulk-import from Tally in Data Ingestion."
        filters={[
          {
            key: "category",
            label: "All categories",
            options: [
              { value: "__none__", label: "Uncategorised" },
              ...categoryOptions.map((c) => ({ value: c, label: c })),
            ],
            matches: (r, v) =>
              v === "__none__" ? !r.customerCategory : r.customerCategory === v,
          },
          {
            key: "rep",
            label: "All sales reps",
            options: [
              { value: "__none__", label: "Unassigned" },
              ...salesReps.map((s) => ({ value: s.id, label: s.name })),
            ],
            matches: (r, v) => (v === "__none__" ? !r.salesRepId : r.salesRepId === v),
          },
          {
            key: "class",
            label: "All classes",
            options: VOLUME_CLASSES.map((c) => ({ value: c, label: VOLUME_CLASS_LABELS[c] })),
            matches: (r, v) => r.volumeClass === v,
          },
          {
            key: "pattern",
            label: "All patterns",
            options: PURCHASE_PATTERNS.map((p) => ({ value: p, label: PURCHASE_PATTERN_LABELS[p] })),
            matches: (r, v) => r.purchasePattern === v,
          },
          {
            key: "sensitivity",
            label: "All behaviours",
            options: CUSTOMER_SENSITIVITIES.map((s) => ({
              value: s,
              label: CUSTOMER_SENSITIVITY_LABELS[s],
            })),
            matches: (r, v) => r.sensitivity === v,
          },
        ]}
        actions={(r) => (
          <>
            <RowBtn title="Edit" onClick={() => setEditing(r)}>
              <Pencil size={14} strokeWidth={2.3} />
            </RowBtn>
            <RowBtn
              title="Delete"
              danger
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete "${r.name}"?`)) return;
                start(async () => {
                  const res = await deleteCustomer(r.id);
                  res.ok ? toast.success("Customer deleted") : toast.error(res.error);
                });
              }}
            >
              <Trash2 size={14} strokeWidth={2.3} />
            </RowBtn>
          </>
        )}
      />

      {editing && (
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
    salesRepId: row?.salesRepId ?? "",
    customerCategory: row?.customerCategory ?? "",
    volumeClass: (row?.volumeClass ?? "") as VolumeClass | "",
    purchasePattern: (row?.purchasePattern ?? "") as PurchasePattern | "",
    sensitivity: (row?.sensitivity ?? "") as CustomerSensitivity | "",
    contactPerson: row?.contactPerson ?? "",
    phone: row?.phone ?? "",
    email: row?.email ?? "",
    city: row?.city ?? "",
    state: row?.state ?? "",
    gstin: row?.gstin ?? "",
    tallyGroup: row?.tallyGroup ?? "",
    notes: "",
    isActive: row?.isActive ?? true,
  });
  const [pending, start] = React.useTransition();
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveCustomer(row?.id ?? null, {
        ...f,
        volumeClass: f.volumeClass === "" ? null : f.volumeClass,
        purchasePattern: f.purchasePattern === "" ? null : f.purchasePattern,
        sensitivity: f.sensitivity === "" ? null : f.sensitivity,
      });
      if (res.ok) {
        toast.success(row ? "Customer updated" : "Customer created");
        onClose();
      } else toast.error(res.error);
    });
  }

  return (
    <Drawer
      open
      width={560}
      title={row ? "Edit customer" : "New customer"}
      subtitle="Classifications are optional — leave blank until you know."
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} />
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Customer name" required>
          <TextInput value={f.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <TextInput value={f.code} onChange={(e) => set("code", e.target.value)} />
          </Field>
          <Field label="GSTIN">
            <TextInput value={f.gstin} onChange={(e) => set("gstin", e.target.value)} />
          </Field>
        </div>

        <Field label="Sales representative" required hint="Every customer needs an owner.">
          <SelectInput value={f.salesRepId} onChange={(e) => set("salesRepId", e.target.value)} required>
            <option value="">— pick a salesperson —</option>
            {salesReps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field
          label="Customer category"
          hint="Manage these options in System Libraries — no developer needed."
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
            {/* A value that predates the current list (or came from an import)
                must stay selectable, or opening the form would silently blank
                it on the next save. */}
            {f.customerCategory && !categoryOptions.includes(f.customerCategory) && (
              <option value={f.customerCategory}>{f.customerCategory} (retired)</option>
            )}
          </SelectInput>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Volume class">
            <SelectInput value={f.volumeClass} onChange={(e) => set("volumeClass", e.target.value)}>
              <option value="">— not classified —</option>
              {VOLUME_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {VOLUME_CLASS_LABELS[c]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Purchasing pattern">
            <SelectInput value={f.purchasePattern} onChange={(e) => set("purchasePattern", e.target.value)}>
              <option value="">— not classified —</option>
              {PURCHASE_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {PURCHASE_PATTERN_LABELS[p]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <Field label="Sensitivity / behaviour">
          <SelectInput value={f.sensitivity} onChange={(e) => set("sensitivity", e.target.value)}>
            <option value="">— not classified —</option>
            {CUSTOMER_SENSITIVITIES.map((s) => (
              <option key={s} value={s}>
                {CUSTOMER_SENSITIVITY_LABELS[s]}
              </option>
            ))}
          </SelectInput>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person">
            <TextInput value={f.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />
          </Field>
          <Field label="Phone">
            <TextInput value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="City">
            <TextInput value={f.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="State">
            <TextInput value={f.state} onChange={(e) => set("state", e.target.value)} />
          </Field>
          <Field label="Tally group" hint="e.g. Sundry Debtors">
            <TextInput value={f.tallyGroup} onChange={(e) => set("tallyGroup", e.target.value)} />
          </Field>
        </div>

        <Field label="Notes">
          <TextArea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        <Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Active" />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
