"use client";

import * as React from "react";
import type { ClientAddressRow } from "@/lib/queries/client-kyc";
import { CLIENT_ADDRESS_TYPES, CLIENT_ADDRESS_TYPE_LABELS } from "@/db/enums";
import {
  DataTable,
  Dash,
  type Column,
  type FilterDef,
  type SortDef,
} from "@/components/admin/master/data-table";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteClientAddresses,
  updateClientAddress,
} from "@/app/(forms-module)/forms/client-kyc/actions";
import { CodeCell } from "@/components/masters/row-menu";
import { TypePill, distinctValues } from "./kyc/master-list";
import {
  RecordEditDialog,
  asOptions,
  type EditField,
  type EditValues,
} from "./kyc/record-edit-dialog";
import { KYC_ACCENT } from "./kyc/tokens";
import { InlineSelect, type SaveResult } from "@/components/admin/master/inline-edit";
import { MasterGrid, type GridCol } from "@/components/admin/master/master-grid";
import { ViewSwitch, type MasterView } from "@/components/admin/master/view-switch";
import { KYC_ACCENT_SOFT } from "./kyc/tokens";

/**
 * Client Address Book — every address, one row per address.
 *
 * This screen used to be a contact directory that happened to show a city:
 * contact name, designation, phone and email, with the address reduced to
 * "City / State". Contacts now have their own section, so this one is what
 * its name always claimed — addresses, and nothing else.
 *
 * Same shared `DataTable` chrome as Client Master and Client Contact Master,
 * so the tiles, search, filter chips, sort, export and pagination are the
 * exact components at the exact sizes.
 */
export function ClientAddressBook({
  rows,
  states,
  countries,
}: {
  rows: ClientAddressRow[];
  /** The admin-managed State list — the KYC form's own address picker. */
  states: string[];
  /** The admin-managed Country list, same source. */
  countries: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ClientAddressRow | null>(null);
  const [view, setView] = React.useState<MasterView>("table");

  /**
   * Bulk delete for the ticked rows. The table asks for confirmation and
   * owns the busy state; this just does it and reports back.
   */
  async function removeSelected(selected: { id: string }[]) {
    try {
      const res = await deleteClientAddresses(selected.map((r) => r.id));
      if (res.ok) {
        toast.success(
          `${selected.length} address${selected.length === 1 ? "" : "s"} deleted.`,
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
      return res;
    } catch {
      const error = "Couldn't reach the server. Try again in a moment.";
      toast.error(error);
      return { ok: false as const, error };
    }
  }
  const EDIT_FIELDS: EditField[] = [
    {
      key: "addressType",
      label: "Address Type",
      type: "select",
      span: 2,
      options: CLIENT_ADDRESS_TYPES.map((t) => ({
        value: t,
        label: CLIENT_ADDRESS_TYPE_LABELS[t],
      })),
    },
    { key: "line1", label: "Address Line 1", span: 2, maxLength: 200 },
    { key: "line2", label: "Address Line 2", span: 2, maxLength: 200 },
    { key: "line3", label: "Address Line 3", span: 2, maxLength: 200 },
    { key: "line4", label: "Address Line 4", span: 2, maxLength: 200 },
    // City has no master list — it is typed per address — so its suggestions
    // are the cities already on record, which is what keeps "Pune" from
    // gaining a "pune" twin. State and Country do have lists; both stay
    // combos rather than closed selects because the column is free text and
    // the list is admin-managed, so a value nobody has added yet must still
    // save.
    {
      key: "city",
      label: "City",
      type: "combo",
      span: 1,
      maxLength: 120,
      options: asOptions(distinctValues(rows, (r) => r.city)),
    },
    { key: "state", label: "State", type: "combo", span: 1, maxLength: 120, options: asOptions(states) },
    {
      key: "country",
      label: "Country",
      type: "combo",
      span: 1,
      maxLength: 120,
      options: asOptions(countries),
    },
    { key: "pinCode", label: "Pin Code", span: 1, inputMode: "numeric", maxLength: 20 },
    // Collected on Invoice Mailing in the KYC form; editable here on any row
    // because the column exists on all of them.
    { key: "email", label: "Email", span: 2, inputMode: "email", maxLength: 200 },
  ];

  async function saveEdit(v: EditValues) {
    if (!editing) return { ok: false as const, error: "Nothing to save." };
    const res = await updateClientAddress(editing.id, v);
    if (res.ok) router.refresh();
    return res;
  }

  /**
   * Save one field of one row, from a cell edited in place.
   *
   * Sends the whole address rebuilt from the row, because
   * `updateClientAddress` takes a complete one — the same payload the dialog
   * sends, so there is no second write path to drift from it.
   */
  const patch = React.useCallback(
    async (row: ClientAddressRow, changes: EditValues): Promise<SaveResult> => {
      const res = await updateClientAddress(row.id, {
        addressType: row.addressType,
        line1: row.line1 ?? "",
        line2: row.line2 ?? "",
        line3: row.line3 ?? "",
        line4: row.line4 ?? "",
        city: row.city ?? "",
        state: row.state ?? "",
        country: row.country ?? "",
        pinCode: row.pinCode ?? "",
        email: row.email ?? "",
        ...changes,
      });
      if (!res.ok) return { ok: false, error: res.error };
      router.refresh();
      return { ok: true };
    },
    [router],
  );

  /** Cities already on record, as the City cell's options. */
  const cityOptions = React.useMemo(() => distinctValues(rows, (r) => r.city), [rows]);

  /** Address Type is an enum shown by its label, so the picker maps back. */
  const ADDRESS_TYPE_LABELS = CLIENT_ADDRESS_TYPES.map((t) => CLIENT_ADDRESS_TYPE_LABELS[t]);
  const addressTypeByLabel = new Map(
    CLIENT_ADDRESS_TYPES.map((t) => [CLIENT_ADDRESS_TYPE_LABELS[t], t]),
  );

  const viewSwitch = <ViewSwitch view={view} onChange={setView} accent={KYC_ACCENT} />;

  /**
   * Grid View — every address as one editable row, the four street lines
   * included. The table joins those into one Street Address cell to stay
   * readable; the sheet keeps them apart, because correcting line 2 is
   * exactly the kind of pass this view is for.
   */
  const gridColumns: GridCol<ClientAddressRow>[] = [
    { key: "company", label: "Company", width: 210, kind: "text", frozen: true, readOnly: true, get: (r) => r.company },
    { key: "code", label: "Client Number", width: 130, kind: "text", frozen: true, readOnly: true, mono: true, get: (r) => r.code ?? "" },
    { key: "addressType", label: "Type", width: 185, kind: "select", options: ADDRESS_TYPE_LABELS, get: (r) => r.typeLabel },
    { key: "line1", label: "Address Line 1", width: 240, kind: "text", maxLength: 200, get: (r) => r.line1 ?? "" },
    { key: "line2", label: "Address Line 2", width: 240, kind: "text", maxLength: 200, get: (r) => r.line2 ?? "" },
    { key: "line3", label: "Address Line 3", width: 240, kind: "text", maxLength: 200, get: (r) => r.line3 ?? "" },
    { key: "line4", label: "Address Line 4", width: 240, kind: "text", maxLength: 200, get: (r) => r.line4 ?? "" },
    { key: "city", label: "City", width: 175, kind: "select", freeText: true, options: cityOptions, get: (r) => r.city ?? "" },
    { key: "state", label: "State", width: 175, kind: "select", freeText: true, options: states, get: (r) => r.state ?? "" },
    { key: "country", label: "Country", width: 165, kind: "select", freeText: true, options: countries, get: (r) => r.country ?? "" },
    { key: "pinCode", label: "Pin Code", width: 130, kind: "text", maxLength: 20, get: (r) => r.pinCode ?? "" },
    { key: "email", label: "Email", width: 230, kind: "text", maxLength: 200, get: (r) => r.email ?? "" },
  ];

  async function saveGridRow(row: ClientAddressRow, cells: Record<string, string>) {
    const g = (k: string) => cells[k] ?? "";
    return patch(row, {
      addressType: addressTypeByLabel.get(g("addressType")) ?? row.addressType,
      line1: g("line1"),
      line2: g("line2"),
      line3: g("line3"),
      line4: g("line4"),
      city: g("city"),
      state: g("state"),
      country: g("country"),
      pinCode: g("pinCode"),
      email: g("email"),
    });
  }

  const columns: Column<ClientAddressRow>[] = [
    {
      key: "code",
      header: "Client Code",
      width: 110,
      render: (r) => (r.code ? <CodeCell>{r.code}</CodeCell> : <Dash />),
      value: (r) => r.code ?? "",
    },
    {
      key: "company",
      header: "Company",
      width: 190,
      render: (r) => <strong className="text-ink-strong">{r.company}</strong>,
    },
    {
      key: "type",
      header: "Type",
      width: 190,
      // Billing / Delivery / Invoice Mailing — a closed enum, so the cell
      // offers its three labels and hands back the value behind the one
      // picked. Not clearable: an address is always one of the three.
      render: (r) => (
        <InlineSelect
          value={r.typeLabel}
          options={ADDRESS_TYPE_LABELS}
          clearable={false}
          field="Type"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) =>
            patch(r, { addressType: next ? (addressTypeByLabel.get(next) ?? r.addressType) : r.addressType })
          }
        />
      ),
      value: (r) => r.typeLabel,
    },
    {
      key: "street",
      header: "Street Address",
      width: 280,
      render: (r) =>
        r.street ? <span className="text-ink-strong break-words">{r.street}</span> : <Dash />,
      value: (r) => r.street ?? "",
    },
    {
      key: "city",
      header: "City",
      width: 165,
      // No master list — cities are typed per address — so the menu offers
      // the ones already on record. That is what stops one city arriving as
      // "Pune", "pune" and "PUNE".
      render: (r) => (
        <InlineSelect
          value={r.city}
          options={cityOptions}
          field="City"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) => patch(r, { city: next ?? "" })}
        />
      ),
      value: (r) => r.city ?? "",
    },
    {
      key: "state",
      header: "State",
      width: 165,
      // The two fields on an address that come off a master list, so the two
      // that are dropdowns here. The rest is street text, typed per address.
      render: (r) => (
        <InlineSelect
          value={r.state}
          options={states}
          field="State"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) => patch(r, { state: next ?? "" })}
        />
      ),
      value: (r) => r.state ?? "",
    },
    {
      key: "country",
      header: "Country",
      width: 155,
      render: (r) => (
        <InlineSelect
          value={r.country}
          options={countries}
          field="Country"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) => patch(r, { country: next ?? "" })}
        />
      ),
      value: (r) => r.country ?? "",
    },
    {
      key: "pinCode",
      header: "Pin Code",
      width: 90,
      render: (r) => (r.pinCode ? <span className="tabular-nums">{r.pinCode}</span> : <Dash />),
      value: (r) => r.pinCode ?? "",
    },
    {
      key: "email",
      header: "Email",
      width: 200,
      // Only the Invoice Mailing block collects an email — the other two types
      // show a dash rather than an empty cell.
      render: (r) =>
        r.email ? (
          <a
            href={`mailto:${r.email}`}
            className="break-all hover:underline"
            style={{ color: KYC_ACCENT }}
          >
            {r.email}
          </a>
        ) : (
          <Dash />
        ),
      value: (r) => r.email ?? "",
    },
  ];

  const filters: FilterDef<ClientAddressRow>[] = [
    {
      key: "type",
      label: "Type",
      options: CLIENT_ADDRESS_TYPES.map((t) => ({
        value: t,
        label: CLIENT_ADDRESS_TYPE_LABELS[t],
      })),
      matches: (r, v) => r.addressType === v,
    },
    {
      key: "company",
      label: "Company",
      options: distinctValues(rows, (r) => r.company).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.company === v,
    },
    {
      key: "city",
      label: "City",
      options: distinctValues(rows, (r) => r.city).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.city === v,
    },
    {
      key: "state",
      label: "State",
      options: distinctValues(rows, (r) => r.state).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.state === v,
    },
  ];

  const sorts: SortDef<ClientAddressRow>[] = [
    { value: "company", label: "Company A–Z", compare: (a, b) => a.company.localeCompare(b.company) },
    {
      value: "company-desc",
      label: "Company Z–A",
      compare: (a, b) => b.company.localeCompare(a.company),
    },
    {
      value: "city",
      label: "City A–Z",
      compare: (a, b) => (a.city ?? "").localeCompare(b.city ?? ""),
    },
    {
      value: "type",
      label: "Address Type",
      compare: (a, b) =>
        CLIENT_ADDRESS_TYPES.indexOf(a.addressType) -
          CLIENT_ADDRESS_TYPES.indexOf(b.addressType) || a.company.localeCompare(b.company),
    },
  ];

  if (view === "grid") {
    return (
      <MasterGrid
        rows={rows}
        columns={gridColumns}
        title="Client Address Book"
        primaryKey="company"
        primarySearchLabel="Search company"
        accent={KYC_ACCENT}
        accentSoft={KYC_ACCENT_SOFT}
        toolbar={viewSwitch}
        save={saveGridRow}
        noun="addresses"
      />
    );
  }

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        headerActions={viewSwitch}
        filters={filters}
        sorts={sorts}
        title="Client Address Book"
        countNoun="addresses"
        searchPlaceholder="Search company, code, street, city, pin…"
        csvName="client-address-book"
        exportLabel="Export"
        selectable
        rowDetail
        onBulkDelete={removeSelected}
        deleteNoun="address"
        onEdit={(r) => setEditing(r)}
        rowDetailTitle={(r) => `${r.company} — ${r.typeLabel}`}
        accent={KYC_ACCENT}
        fullscreen
        tintHeader
        emptyTitle="No addresses yet."
        emptySub="Addresses appear here as soon as a client is onboarded with one."
      />

      {editing && (
        <RecordEditDialog
          title={`${editing.company} — ${editing.typeLabel}`}
          fields={EDIT_FIELDS}
          initial={{
            addressType: editing.addressType,
            line1: editing.line1 ?? "",
            line2: editing.line2 ?? "",
            line3: editing.line3 ?? "",
            line4: editing.line4 ?? "",
            city: editing.city ?? "",
            state: editing.state ?? "",
            country: editing.country ?? "",
            pinCode: editing.pinCode ?? "",
            email: editing.email ?? "",
          }}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
