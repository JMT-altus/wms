"use client";

import * as React from "react";
import type { ClientContactRow, RosterOption } from "@/lib/queries/client-kyc";
import { CLIENT_CONTACT_TYPES, CLIENT_CONTACT_TYPE_LABELS } from "@/db/enums";
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
  deleteClientContacts,
  updateClientContact,
} from "@/app/(forms-module)/forms/client-kyc/actions";
import { CodeCell } from "@/components/masters/row-menu";
import { TypePill, distinctValues } from "./kyc/master-list";
import {
  RecordEditDialog,
  type EditField,
  type EditValues,
} from "./kyc/record-edit-dialog";
// From `tokens` rather than `fields`: fields.tsx is the whole KYC control
// library, and this table needs one colour constant, not the controls.
import { KYC_ACCENT } from "./kyc/tokens";
import { InlineSelect, type SaveResult } from "@/components/admin/master/inline-edit";
import { MasterGrid, type GridCol } from "@/components/admin/master/master-grid";
import { ViewSwitch, type MasterView } from "@/components/admin/master/view-switch";
import { KYC_ACCENT_SOFT } from "./kyc/tokens";

/**
 * Client Contact Master — every contact person, one row per person.
 *
 * This section owns contact data. Client Master used to carry a single
 * "Contact Person" column, which could only ever name one of a client's
 * several contacts and quietly implied the rest did not exist; that column is
 * gone and this list replaced it.
 *
 * Built on the shared `DataTable` in title mode — the same chrome Client
 * Master, Product Master and Customer Master already use. Summary tiles,
 * search, filter chips, sort, export and 25/50/100 pagination are therefore
 * the exact components at the exact sizes, not a second look-alike toolbar
 * that would drift from them.
 */

/** A person is only reachable if they carry a phone or an email. */
function isReachable(r: ClientContactRow): boolean {
  return Boolean(r.contactNo?.trim() || r.email?.trim());
}

function fullName(r: ClientContactRow): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
}

export function ClientContactMaster({
  rows,
  designations,
  departments,
}: {
  rows: ClientContactRow[];
  /** Roster options for the edit form's two pickers. */
  designations: RosterOption[];
  departments: RosterOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ClientContactRow | null>(null);
  const [view, setView] = React.useState<MasterView>("table");

  /**
   * Bulk delete for the ticked rows. The table asks for confirmation and
   * owns the busy state; this just does it and reports back.
   */
  async function removeSelected(selected: { id: string }[]) {
    try {
      const res = await deleteClientContacts(selected.map((r) => r.id));
      if (res.ok) {
        toast.success(
          `${selected.length} contact${selected.length === 1 ? "" : "s"} deleted.`,
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
      key: "contactType",
      label: "Contact Type",
      type: "select",
      options: CLIENT_CONTACT_TYPES.map((t) => ({
        value: t,
        label: CLIENT_CONTACT_TYPE_LABELS[t],
      })),
    },
    { key: "firstName", label: "First Name", maxLength: 80 },
    { key: "lastName", label: "Last Name", maxLength: 80 },
    { key: "contactNo", label: "Contact No", inputMode: "tel", maxLength: 40 },
    { key: "email", label: "Email", inputMode: "email", maxLength: 200 },
    {
      key: "designationId",
      label: "Designation",
      type: "select",
      options: designations.map((d) => ({ value: d.id, label: d.name })),
    },
    {
      key: "departmentId",
      label: "Department",
      type: "select",
      options: departments.map((d) => ({ value: d.id, label: d.name })),
    },
    { key: "notes", label: "Contact Notes", type: "textarea", span: 4, maxLength: 1000 },
  ];

  async function saveEdit(v: EditValues) {
    if (!editing) return { ok: false as const, error: "Nothing to save." };
    const res = await updateClientContact(editing.id, v);
    if (res.ok) router.refresh();
    return res;
  }

  /**
   * Save one field of one row, from a cell edited in place. Rebuilds the whole
   * contact from the row, because `updateClientContact` takes a complete one —
   * the same payload the dialog sends.
   */
  const patch = React.useCallback(
    async (row: ClientContactRow, changes: EditValues): Promise<SaveResult> => {
      const res = await updateClientContact(row.id, {
        contactType: row.contactType,
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        contactNo: row.contactNo ?? "",
        email: row.email ?? "",
        designationId: row.designationId ?? "",
        departmentId: row.departmentId ?? "",
        notes: row.notes ?? "",
        ...changes,
      });
      if (!res.ok) return { ok: false, error: res.error };
      router.refresh();
      return { ok: true };
    },
    [router],
  );

  /** The two roster pickers work in names; the row stores ids. */
  const designationNames = designations.map((d) => d.name);
  const departmentNames = departments.map((d) => d.name);
  const designationIdByName = new Map(designations.map((d) => [d.name, d.id]));
  const departmentIdByName = new Map(departments.map((d) => [d.name, d.id]));

  /** Contact Type is an enum shown by its label, so the picker maps back. */
  const CONTACT_TYPE_LABELS = CLIENT_CONTACT_TYPES.map((t) => CLIENT_CONTACT_TYPE_LABELS[t]);
  const contactTypeByLabel = new Map(
    CLIENT_CONTACT_TYPES.map((t) => [CLIENT_CONTACT_TYPE_LABELS[t], t]),
  );

  const viewSwitch = <ViewSwitch view={view} onChange={setView} accent={KYC_ACCENT} />;

  /**
   * Grid View — every contact as one editable row.
   *
   * Company and Client Code lead and are read-only: which client a contact
   * belongs to is not a cell edit. Re-parenting a contact would be moving a
   * person between companies, which the update action deliberately refuses.
   */
  const gridColumns: GridCol<ClientContactRow>[] = [
    { key: "company", label: "Company", width: 210, kind: "text", frozen: true, readOnly: true, get: (r) => r.company },
    { key: "code", label: "Client Number", width: 130, kind: "text", frozen: true, readOnly: true, mono: true, get: (r) => r.code ?? "" },
    { key: "contactType", label: "Type", width: 170, kind: "select", options: CONTACT_TYPE_LABELS, get: (r) => r.typeLabel },
    { key: "firstName", label: "First Name", width: 170, kind: "text", maxLength: 80, get: (r) => r.firstName ?? "" },
    { key: "lastName", label: "Last Name", width: 170, kind: "text", maxLength: 80, get: (r) => r.lastName ?? "" },
    { key: "contactNo", label: "Contact No", width: 160, kind: "text", maxLength: 40, get: (r) => r.contactNo ?? "" },
    { key: "email", label: "Email", width: 230, kind: "text", maxLength: 200, get: (r) => r.email ?? "" },
    { key: "designation", label: "Designation", width: 180, kind: "select", options: designationNames, get: (r) => r.designation ?? "" },
    { key: "department", label: "Department", width: 180, kind: "select", options: departmentNames, get: (r) => r.department ?? "" },
    { key: "notes", label: "Contact Notes", width: 280, kind: "text", maxLength: 1000, get: (r) => r.notes ?? "" },
  ];

  async function saveGridRow(row: ClientContactRow, cells: Record<string, string>) {
    const g = (k: string) => cells[k] ?? "";
    return patch(row, {
      contactType: contactTypeByLabel.get(g("contactType")) ?? row.contactType,
      firstName: g("firstName"),
      lastName: g("lastName"),
      contactNo: g("contactNo"),
      email: g("email"),
      designationId: g("designation") ? (designationIdByName.get(g("designation")) ?? "") : "",
      departmentId: g("department") ? (departmentIdByName.get(g("department")) ?? "") : "",
      notes: g("notes"),
    });
  }

  const columns: Column<ClientContactRow>[] = [
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
      width: 175,
      // A closed enum, so the cell offers exactly its three labels and hands
      // back the value behind whichever was picked.
      render: (r) => (
        <InlineSelect
          value={r.typeLabel}
          options={CONTACT_TYPE_LABELS}
          field="Type"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) =>
            patch(r, { contactType: next ? (contactTypeByLabel.get(next) ?? r.contactType) : r.contactType })
          }
        />
      ),
      value: (r) => r.typeLabel,
    },
    {
      key: "firstName",
      header: "First Name",
      width: 130,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {r.firstName ? <strong className="text-ink-strong">{r.firstName}</strong> : <Dash />}
          {r.isPrimary && <TypePill label="Primary" strong />}
        </span>
      ),
      value: (r) => r.firstName ?? "",
    },
    {
      key: "lastName",
      header: "Last Name",
      width: 130,
      render: (r) =>
        r.lastName ? <strong className="text-ink-strong">{r.lastName}</strong> : <Dash />,
      value: (r) => r.lastName ?? "",
    },
    {
      key: "contactNo",
      header: "Contact No",
      width: 140,
      render: (r) => (r.contactNo ? <span className="tabular-nums">{r.contactNo}</span> : <Dash />),
      value: (r) => r.contactNo ?? "",
    },
    {
      key: "email",
      header: "Email",
      width: 210,
      render: (r) =>
        r.email ? (
          // mailto rather than plain text — this is a directory, and the one
          // thing anyone does with an address here is write to it.
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
    {
      key: "designation",
      header: "Designation",
      width: 175,
      // Both come off a roster the admin maintains, so both are dropdowns —
      // and both store an id, so the picker works in names and hands the id
      // back.
      render: (r) => (
        <InlineSelect
          value={r.designation}
          options={designationNames}
          field="Designation"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) =>
            patch(r, { designationId: next ? (designationIdByName.get(next) ?? "") : "" })
          }
        />
      ),
      value: (r) => r.designation ?? "",
    },
    {
      key: "department",
      header: "Department",
      width: 175,
      render: (r) => (
        <InlineSelect
          value={r.department}
          options={departmentNames}
          field="Department"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) =>
            patch(r, { departmentId: next ? (departmentIdByName.get(next) ?? "") : "" })
          }
        />
      ),
      value: (r) => r.department ?? "",
    },
    {
      key: "notes",
      header: "Contact Notes",
      width: 220,
      // Free text that can run long: keep the author's line breaks, and let
      // the column width plus wrapping stop one wordy note stretching the row.
      render: (r) =>
        r.notes ? <span className="whitespace-pre-line break-words">{r.notes}</span> : <Dash />,
      value: (r) => r.notes ?? "",
    },
  ];

  const filters: FilterDef<ClientContactRow>[] = [
    {
      key: "type",
      label: "Type",
      options: CLIENT_CONTACT_TYPES.map((t) => ({
        value: t,
        label: CLIENT_CONTACT_TYPE_LABELS[t],
      })),
      matches: (r, v) => r.contactType === v,
    },
    {
      key: "company",
      label: "Company",
      options: distinctValues(rows, (r) => r.company).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.company === v,
    },
    {
      key: "designation",
      label: "Designation",
      options: distinctValues(rows, (r) => r.designation).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.designation === v,
    },
    {
      key: "department",
      label: "Department",
      options: distinctValues(rows, (r) => r.department).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.department === v,
    },
    {
      key: "reachable",
      label: "Reachable",
      options: [
        { value: "yes", label: "Has phone or email" },
        { value: "no", label: "No way to reach" },
      ],
      matches: (r, v) => (v === "yes" ? isReachable(r) : !isReachable(r)),
    },
  ];

  const sorts: SortDef<ClientContactRow>[] = [
    {
      value: "company",
      label: "Company A–Z",
      compare: (a, b) => a.company.localeCompare(b.company),
    },
    {
      value: "company-desc",
      label: "Company Z–A",
      compare: (a, b) => b.company.localeCompare(a.company),
    },
    {
      value: "person",
      label: "Contact Person A–Z",
      compare: (a, b) => fullName(a).localeCompare(fullName(b)),
    },
    {
      value: "type",
      label: "Contact Type",
      compare: (a, b) =>
        CLIENT_CONTACT_TYPES.indexOf(a.contactType) -
          CLIENT_CONTACT_TYPES.indexOf(b.contactType) || a.company.localeCompare(b.company),
    },
  ];

  if (view === "grid") {
    return (
      <MasterGrid
        rows={rows}
        columns={gridColumns}
        title="Client Contact Master"
        primaryKey="company"
        primarySearchLabel="Search company"
        accent={KYC_ACCENT}
        accentSoft={KYC_ACCENT_SOFT}
        toolbar={viewSwitch}
        save={saveGridRow}
        noun="contacts"
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
      title="Client Contact Master"
      countNoun="contacts"
      searchPlaceholder="Search name, company, code, email…"
      csvName="client-contact-master"
      exportLabel="Export"
      selectable
      rowDetail
      onBulkDelete={removeSelected}
      deleteNoun="contact"
      onEdit={(r) => setEditing(r)}
      rowDetailTitle={(r) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.company}
      accent={KYC_ACCENT}
      fullscreen
      tintHeader
      emptyTitle="No contacts yet."
      emptySub="Contacts appear here as soon as a client is onboarded with one."
      />

      {editing && (
        <RecordEditDialog
          title={
            [editing.firstName, editing.lastName].filter(Boolean).join(" ") || editing.company
          }
          fields={EDIT_FIELDS}
          initial={{
            contactType: editing.contactType,
            firstName: editing.firstName ?? "",
            lastName: editing.lastName ?? "",
            contactNo: editing.contactNo ?? "",
            email: editing.email ?? "",
            designationId: editing.designationId ?? "",
            departmentId: editing.departmentId ?? "",
            notes: editing.notes ?? "",
          }}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
