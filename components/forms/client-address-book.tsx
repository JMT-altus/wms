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
  type EditField,
  type EditValues,
} from "./kyc/record-edit-dialog";
import { KYC_ACCENT } from "./kyc/tokens";

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
export function ClientAddressBook({ rows }: { rows: ClientAddressRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ClientAddressRow | null>(null);

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
    { key: "city", label: "City", span: 1, maxLength: 120 },
    { key: "state", label: "State", span: 1, maxLength: 120 },
    { key: "country", label: "Country", span: 1, maxLength: 120 },
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
      width: 155,
      render: (r) => <TypePill label={r.typeLabel} />,
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
      width: 120,
      render: (r) => r.city ?? <Dash />,
      value: (r) => r.city ?? "",
    },
    {
      key: "state",
      header: "State",
      width: 130,
      render: (r) => r.state ?? <Dash />,
      value: (r) => r.state ?? "",
    },
    {
      key: "country",
      header: "Country",
      width: 110,
      render: (r) => r.country ?? <Dash />,
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

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
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
