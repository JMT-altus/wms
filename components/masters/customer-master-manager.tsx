"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoonStar, Sunrise } from "lucide-react";
import type { CustomerRow } from "@/lib/queries/master-data";
import { formatInr } from "@/lib/format";
import {
  deleteMasterCustomer,
  reactivateCustomers,
  saveMasterCustomer,
  setCustomersDormant,
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
  NumberField,
  SelectInput,
  TextInput,
  Toggle,
} from "@/components/admin/master/drawer";
import { CodeCell, RowMenu, StatusCell } from "./row-menu";
import { MastersDialog } from "./masters-dialog";
import { MASTERS_GRADIENT } from "./theme";
import { BulkUpload } from "./bulk-upload";
import { InlineNumber, InlineSelect, type SaveResult } from "@/components/admin/master/inline-edit";
import { ACTIVE_STATUS, YES_NO } from "@/lib/forms/client-bulk-columns";
import { MasterGrid, type GridCol } from "@/components/admin/master/master-grid";
import { ViewSwitch, type MasterView } from "@/components/admin/master/view-switch";
import { MASTERS_ACCENT, MASTERS_ACCENT_SOFT } from "./theme";
import {
  STATUS_FILTER_DEFAULT,
  STATUS_FILTER_OPTIONS,
  customerCountLabel,
  isDormant,
  matchesStatusFilter,
  statusLabel,
} from "@/lib/masters/dormancy";

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
  const [view, setView] = React.useState<MasterView>("table");
  const [pending, start] = React.useTransition();

  const viewSwitch = <ViewSwitch view={view} onChange={setView} accent={MASTERS_GRADIENT} />;

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
      width: 200,
      // Editable where it sits: the category is the one field on this screen
      // people re-classify in passing, and it comes straight off the
      // admin-managed `customer_category` list.
      render: (r) => (
        <InlineSelect
          value={r.customerCategory}
          options={categoryOptions}
          field="Customer Category"
          rowLabel={r.name}
          accent="var(--color-purple-deep)"
          accentSoft="color-mix(in srgb, var(--color-purple) 10%, transparent)"
          onSave={(next) => patch(r, { customerCategory: next })}
        />
      ),
      value: (r) => r.customerCategory ?? "",
    },
    {
      key: "creditLimit",
      header: "Credit Limit",
      width: 175,
      // Type any figure; the steppers move it one at a time from wherever it
      // lands, the same as the Client Master's.
      render: (r) => (
        <InlineNumber
          value={r.creditLimit === null ? null : Number(r.creditLimit)}
          step={1}
          format={formatInr}
          field="Credit Limit"
          rowLabel={r.name}
          onSave={(next) => patch(r, { creditLimit: next })}
        />
      ),
      value: (r) => r.creditLimit ?? "",
    },
    {
      key: "creditPeriodDays",
      header: "Credit Period",
      width: 155,
      render: (r) => (
        <InlineNumber
          value={r.creditPeriodDays}
          step={1}
          format={(n) => `${n} Day${n === 1 ? "" : "s"}`}
          field="Credit Period"
          rowLabel={r.name}
          onSave={(next) => patch(r, { creditPeriodDays: next })}
        />
      ),
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
      render: (r) => <StatusCell active={r.isActive} dormant={isDormant(r)} />,
      // Matches what the cell renders, so a search for "dormant" finds the
      // rows the Dormant filter shows and the export says the same thing.
      value: statusLabel,
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

  /**
   * Save one field of one row, from a cell edited in place.
   *
   * Rebuilds the whole customer from the row with the change applied, because
   * `saveMasterCustomer` takes a complete record — and deliberately carries
   * the three fields this screen's form no longer shows, so an inline edit
   * can't blank a value set in Master Setup or by bulk upload, exactly as the
   * dialog does.
   */
  const patch = React.useCallback(
    async (
      row: CustomerRow,
      changes: { customerCategory?: string | null; creditLimit?: number | null; creditPeriodDays?: number | null },
    ): Promise<SaveResult> => {
      const res = await saveMasterCustomer(row.id, {
        name: row.name,
        customerCategory: row.customerCategory,
        creditLimit: row.creditLimit,
        creditPeriodDays: row.creditPeriodDays,
        focusedView: row.focusedView,
        purchasePattern: row.purchasePattern,
        sensitivity: row.sensitivity,
        salesRepId: row.salesRepId,
        isActive: row.isActive,
        ...changes,
      });
      if (!res.ok) return { ok: false, error: res.error };
      router.refresh();
      return { ok: true };
    },
    [router],
  );

  /**
   * Park one customer as dormant, or bring it back.
   *
   * Per row rather than per selection, because this table has no selection —
   * it acts through the "⋯" menu. The Client Master, which does have ticks,
   * offers the same thing in its selection bar.
   *
   * No confirmation: dormancy is reversible from the same menu, and the
   * Status filter's Dormant option is one click away. Delete asks; this does
   * not.
   */
  function toggleDormant(row: CustomerRow) {
    const reactivating = isDormant(row);
    start(async () => {
      try {
        const res = reactivating
          ? await reactivateCustomers([row.id])
          : await setCustomersDormant([row.id]);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(
          reactivating
            ? `${row.name} is back on the register.`
            : `${row.name} set dormant — hidden until Status is set to Dormant.`,
        );
        router.refresh();
      } catch {
        toast.error("Couldn't reach the server. Try again in a moment.");
      }
    });
  }

  function remove(row: CustomerRow) {
    if (!confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    start(async () => {
      const res = await deleteMasterCustomer(row.id);
      if (res.ok) toast.success("Customer deleted.");
      else toast.error(res.error);
    });
  }

  /**
   * Park or reactivate the ticked rows — the Client Master's own control,
   * over the same `customer_masters` rows.
   *
   * One button that flips, decided by the selection itself: with anything
   * still on the register it parks, and only when every picked row is already
   * dormant does it offer Reactivate. A pair of buttons would put "Set
   * Dormant" next to rows that already are.
   */
  function toggleDormantMany(selected: CustomerRow[], clear: () => void) {
    if (selected.length === 0) return;
    const reactivating = selected.every(isDormant);
    start(async () => {
      try {
        const res = reactivating
          ? await reactivateCustomers(selected.map((r) => r.id))
          : await setCustomersDormant(selected.map((r) => r.id));
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

  /**
   * Delete the ticked rows, one at a time and stopping at the first refusal.
   *
   * Sequential rather than `Promise.all`: `deleteMasterCustomer` refuses a
   * customer that is referenced elsewhere, and a parallel run would report
   * one failure while other deletes had already gone through — the count in
   * the message has to be true.
   */
  async function removeSelected(selected: CustomerRow[]) {
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
    toast.success(`${done} customer${done === 1 ? "" : "s"} deleted.`);
    router.refresh();
    return { ok: true as const };
  }

  /**
   * Grid View — the fields this screen's own form owns, as a sheet.
   *
   * Deliberately not every column the table can show: the KYC fields listed
   * there are read-throughs from the Client Master, and `saveMasterCustomer`
   * writes none of them. A cell that silently doesn't save is worse than one
   * that isn't offered.
   */
  const gridColumns: GridCol<CustomerRow>[] = [
    { key: "name", label: "Customer", width: 240, kind: "text", maxLength: 200, frozen: true, get: (r) => r.name },
    {
      key: "code",
      label: "Client Number",
      width: 130,
      kind: "text",
      frozen: true,
      readOnly: true,
      mono: true,
      get: (r) => r.code ?? "",
    },
    {
      key: "customerCategory",
      label: "Customer Category",
      width: 200,
      kind: "select",
      freeText: true,
      options: categoryOptions,
      get: (r) => r.customerCategory ?? "",
    },
    { key: "creditLimit", label: "Credit Limit", width: 160, kind: "number", get: (r) => r.creditLimit ?? "" },
    {
      key: "creditPeriodDays",
      label: "Credit Period",
      width: 150,
      kind: "number",
      get: (r) => (r.creditPeriodDays == null ? "" : String(r.creditPeriodDays)),
    },
    {
      key: "focusedView",
      label: "Focused View",
      width: 150,
      kind: "select",
      options: YES_NO,
      get: (r) => (r.focusedView ? "Yes" : "No"),
    },
    {
      key: "isActive",
      label: "Status",
      width: 150,
      kind: "select",
      options: ACTIVE_STATUS,
      get: (r) => (r.isActive ? "Active" : "Inactive"),
    },
  ];

  async function saveGridRow(row: CustomerRow, cells: Record<string, string>) {
    const num = (v: string) => {
      const t = v.replace(/,/g, "").trim();
      return t === "" ? null : Number(t);
    };
    // The three fields this form no longer shows travel unedited, so a grid
    // edit can't blank a value set in Master Setup or by bulk upload — the
    // same care the dialog takes.
    const res = await saveMasterCustomer(row.id, {
      name: cells.name ?? "",
      customerCategory: cells.customerCategory ?? "",
      creditLimit: num(cells.creditLimit ?? ""),
      creditPeriodDays: num(cells.creditPeriodDays ?? ""),
      focusedView: cells.focusedView === "Yes",
      purchasePattern: row.purchasePattern,
      sensitivity: row.sensitivity,
      salesRepId: row.salesRepId,
      isActive: cells.isActive !== "Inactive",
    });
    if (!res.ok) return { ok: false as const, error: res.error };
    router.refresh();
    return { ok: true as const };
  }

  if (view === "grid") {
    return (
      <MasterGrid
        rows={customers}
        columns={gridColumns}
        title="Customer Master"
        primaryKey="name"
        primarySearchLabel="Search customer"
        accent={MASTERS_ACCENT}
        accentSoft={MASTERS_ACCENT_SOFT}
        toolbar={viewSwitch}
        save={saveGridRow}
        noun="customers"
      />
    );
  }

  return (
    <>
      <DataTable
        rows={customers}
        columns={columns}
        title="Customer Master"
        sorts={sorts}
        tintHeader
        countNoun="customers"
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
            {viewSwitch}
            <BulkUpload target="customers" label="customers" />
          </>
        }
        filters={[
          {
            /*
             * Status, with dormancy folded into it (0101) — literally the
             * same chip the Client Master carries, read from
             * lib/masters/dormancy.ts. These are two screens over one
             * `customer_masters` row, so a customer parked on one is parked
             * on the other.
             */
            key: "status",
            label: "Status",
            defaultValue: STATUS_FILTER_DEFAULT,
            options: STATUS_FILTER_OPTIONS,
            matches: matchesStatusFilter,
          },
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
        // ── The Client Master's own table behaviour, over the same rows ──
        // These two screens read one `customer_masters` register, so a job
        // that can be done to a set of clients there is the same job here:
        // tick the rows, park them, delete them, or open one to read every
        // field. Keeping the capability on one screen and not the other made
        // the choice of screen matter when it should not.
        selectable
        rowDetail
        rowDetailTitle={(r) => r.name}
        selectionActions={({ rows: selected, clear }) => {
          const reactivating = selected.every(isDormant);
          return (
            <button
              type="button"
              disabled={pending}
              onClick={() => toggleDormantMany(selected, clear)}
              title={
                reactivating
                  ? "Put these customers back on the register"
                  : "Park these customers — they leave this list, the Client Master and the three directories"
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
        deleteNoun="customer"
        onEdit={(row) => setEditing(row)}
        // Deactivating is a one-field edit, so it goes through the same action
        // the dialog saves with rather than a second write path that could
        // drift from it. Every other field is carried through untouched.
        onToggleActive={(row) =>
          void saveMasterCustomer(row.id, {
            name: row.name,
            customerCategory: row.customerCategory,
            creditLimit: row.creditLimit,
            creditPeriodDays:
              row.creditPeriodDays != null ? String(row.creditPeriodDays) : null,
            focusedView: row.focusedView,
            purchasePattern: row.purchasePattern,
            sensitivity: row.sensitivity,
            salesRepId: row.salesRepId,
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
        emptyTitle="No customers yet."
        emptySub="Add one with New Customer, or bring your existing list in with Bulk Upload."
        actions={(row) => (
          <RowMenu
            label={row.name}
            disabled={pending}
            onEdit={() => setEditing(row)}
            onDelete={() => remove(row)}
            dormant={isDormant(row)}
            onToggleDormant={() => toggleDormant(row)}
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

        {/* Steppers rather than bare number boxes: both figures are reviewed
            in round units — a lakh of credit, a fortnight of days — and the
            buttons move them by exactly that. Typing still works for anything
            off the step. */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Credit limit">
            <NumberField
              value={f.creditLimit}
              onChange={(v) => set("creditLimit", v)}
              step={100000}
              placeholder="0"
              hint={
                f.creditLimit.trim() && Number.isFinite(Number(f.creditLimit.replace(/,/g, "")))
                  ? formatInr(Number(f.creditLimit.replace(/,/g, "")))
                  : "Maximum credit allowed, in ₹."
              }
            />
          </Field>

          <Field label="Credit period">
            <NumberField
              value={f.creditPeriodDays}
              onChange={(v) => set("creditPeriodDays", v)}
              step={15}
              placeholder="0"
              hint="Days of credit allowed, e.g. 30."
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
