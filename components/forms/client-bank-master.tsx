"use client";

import * as React from "react";
import type { ClientBankRow } from "@/lib/queries/client-kyc";
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
  deleteClientBankAccounts,
  updateClientBankAccount,
} from "@/app/(forms-module)/forms/client-kyc/actions";
import { CodeCell } from "@/components/masters/row-menu";
import { TypePill, distinctValues } from "./kyc/master-list";
import { YES_NO } from "@/lib/forms/client-bulk-columns";
import {
  RecordEditDialog,
  asOptions,
  type EditField,
  type EditValues,
} from "./kyc/record-edit-dialog";
import { KYC_ACCENT } from "./kyc/tokens";
import { InlineSelect, InlineText, type SaveResult } from "@/components/admin/master/inline-edit";
import { MasterGrid, type GridCol } from "@/components/admin/master/master-grid";
import { ViewSwitch, type MasterView } from "@/components/admin/master/view-switch";
import { KYC_ACCENT_SOFT } from "./kyc/tokens";

/** Account numbers and IFSC codes read as codes, not prose. */
const MONO = "var(--font-mono), ui-monospace, monospace";

/**
 * Client Bank Master — every bank account, one row per account.
 *
 * Bank details are their own section for the same reason contacts and
 * addresses are: a client can have several accounts, and squeezing them into
 * the Client Master would have shown one and hidden the rest.
 *
 * Same shared `DataTable` chrome as Client Master and the other two KYC
 * directories, so tiles, search, filters, sort, export and pagination match
 * them exactly.
 */
export function ClientBankMaster({
  rows,
  bankNames,
  accountTypes,
}: {
  rows: ClientBankRow[];
  /** The admin-managed Bank Name list — the KYC form's own picker. */
  bankNames: string[];
  /** The admin-managed Account Type list, same source. */
  accountTypes: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ClientBankRow | null>(null);
  const [view, setView] = React.useState<MasterView>("table");

  /**
   * Bulk delete for the ticked rows. The table asks for confirmation and
   * owns the busy state; this just does it and reports back.
   */
  async function removeSelected(selected: { id: string }[]) {
    try {
      const res = await deleteClientBankAccounts(selected.map((r) => r.id));
      if (res.ok) {
        toast.success(
          `${selected.length} bank account${selected.length === 1 ? "" : "s"} deleted.`,
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
    { key: "accountName", label: "Account Name", maxLength: 160 },
    // Both lists are admin-managed and the columns are free text, so these
    // are combos: pick the bank from the list of scheduled banks, or type the
    // co-operative branch nobody has added yet.
    {
      key: "bankName",
      label: "Bank Name",
      type: "combo",
      maxLength: 160,
      options: asOptions(bankNames),
    },
    { key: "accountNo", label: "Account No", maxLength: 60 },
    { key: "ifscSwift", label: "IFSC / SWIFT", maxLength: 30 },
    { key: "branch", label: "Branch", maxLength: 160 },
    {
      key: "accountType",
      label: "Account Type",
      type: "combo",
      maxLength: 40,
      options: asOptions(accountTypes),
    },
    { key: "isPrimary", label: "Primary", type: "checkbox", placeholder: "This is the primary account" },
  ];

  async function saveEdit(v: EditValues) {
    if (!editing) return { ok: false as const, error: "Nothing to save." };
    const res = await updateClientBankAccount(editing.id, v);
    if (res.ok) router.refresh();
    return res;
  }

  /**
   * Save one field of one row, from a cell edited in place. Rebuilds the whole
   * account from the row, because `updateClientBankAccount` takes a complete
   * one — the same payload the dialog sends.
   */
  const patch = React.useCallback(
    async (row: ClientBankRow, changes: EditValues): Promise<SaveResult> => {
      const res = await updateClientBankAccount(row.id, {
        accountName: row.accountName ?? "",
        bankName: row.bankName ?? "",
        accountNo: row.accountNo ?? "",
        ifscSwift: row.ifscSwift ?? "",
        branch: row.branch ?? "",
        accountType: row.accountType ?? "",
        isPrimary: row.isPrimary,
        ...changes,
      });
      if (!res.ok) return { ok: false, error: res.error };
      router.refresh();
      return { ok: true };
    },
    [router],
  );

  /** Account names already on record, as the Account Name box's suggestions. */
  const accountNameOptions = React.useMemo(
    () => distinctValues(rows, (r) => r.accountName),
    [rows],
  );

  const viewSwitch = <ViewSwitch view={view} onChange={setView} accent={KYC_ACCENT} />;

  /** Grid View — every bank account as one editable row. */
  const gridColumns: GridCol<ClientBankRow>[] = [
    { key: "company", label: "Company", width: 210, kind: "text", frozen: true, readOnly: true, get: (r) => r.company },
    { key: "code", label: "Client Number", width: 130, kind: "text", frozen: true, readOnly: true, mono: true, get: (r) => r.code ?? "" },
    { key: "accountName", label: "Account Name", width: 230, kind: "text", maxLength: 160, get: (r) => r.accountName ?? "" },
    { key: "bankName", label: "Bank Name", width: 220, kind: "select", freeText: true, options: bankNames, get: (r) => r.bankName ?? "" },
    { key: "accountNo", label: "Account No", width: 190, kind: "text", maxLength: 60, get: (r) => r.accountNo ?? "" },
    { key: "ifscSwift", label: "IFSC / SWIFT", width: 170, kind: "text", maxLength: 30, get: (r) => r.ifscSwift ?? "" },
    { key: "branch", label: "Branch", width: 200, kind: "text", maxLength: 160, get: (r) => r.branch ?? "" },
    { key: "accountType", label: "Account Type", width: 175, kind: "select", freeText: true, options: accountTypes, get: (r) => r.accountType ?? "" },
    { key: "isPrimary", label: "Primary", width: 130, kind: "select", options: YES_NO, get: (r) => (r.isPrimary ? "Yes" : "No") },
  ];

  async function saveGridRow(row: ClientBankRow, cells: Record<string, string>) {
    const g = (k: string) => cells[k] ?? "";
    return patch(row, {
      accountName: g("accountName"),
      bankName: g("bankName"),
      accountNo: g("accountNo"),
      ifscSwift: g("ifscSwift"),
      branch: g("branch"),
      accountType: g("accountType"),
      isPrimary: g("isPrimary") === "Yes",
    });
  }

  const columns: Column<ClientBankRow>[] = [
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
      key: "accountName",
      header: "Account Name",
      width: 230,
      // Typed per account, so a box rather than a dropdown — there is no
      // master list of account names and inventing one would be wrong. It
      // does suggest the names already on record, because one company's
      // accounts usually share a name.
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <InlineText
            value={r.accountName}
            suggestions={accountNameOptions}
            maxLength={160}
            field="Account Name"
            rowLabel={r.company}
            onSave={(next) => patch(r, { accountName: next ?? "" })}
          />
          {r.isPrimary && <TypePill label="Primary" strong />}
        </span>
      ),
      value: (r) => r.accountName ?? "",
    },
    {
      key: "bankName",
      header: "Bank Name",
      width: 205,
      // Off the admin-managed bank list, so the cell is that list. A bank
      // already on a row that has since left the list still shows, and can
      // still be changed — the account exists either way.
      render: (r) => (
        <InlineSelect
          value={r.bankName}
          options={bankNames}
          field="Bank Name"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) => patch(r, { bankName: next ?? "" })}
        />
      ),
      value: (r) => r.bankName ?? "",
    },
    {
      key: "accountNo",
      header: "Account No",
      width: 175,
      render: (r) =>
        r.accountNo ? (
          <span className="tabular-nums text-ink-strong" style={{ fontFamily: MONO, fontSize: 12 }}>
            {r.accountNo}
          </span>
        ) : (
          <Dash />
        ),
      value: (r) => r.accountNo ?? "",
    },
    {
      key: "ifscSwift",
      header: "IFSC / SWIFT",
      width: 135,
      render: (r) =>
        r.ifscSwift ? (
          <span style={{ fontFamily: MONO, fontSize: 12 }}>{r.ifscSwift}</span>
        ) : (
          <Dash />
        ),
      value: (r) => r.ifscSwift ?? "",
    },
    {
      key: "branch",
      header: "Branch",
      width: 150,
      render: (r) => r.branch ?? <Dash />,
      value: (r) => r.branch ?? "",
    },
    {
      key: "accountType",
      header: "Account Type",
      width: 165,
      render: (r) => (
        <InlineSelect
          value={r.accountType}
          options={accountTypes}
          field="Account Type"
          rowLabel={r.company}
          accent={KYC_ACCENT}
          onSave={(next) => patch(r, { accountType: next ?? "" })}
        />
      ),
      value: (r) => r.accountType ?? "",
    },
  ];

  const filters: FilterDef<ClientBankRow>[] = [
    {
      key: "company",
      label: "Company",
      options: distinctValues(rows, (r) => r.company).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.company === v,
    },
    {
      key: "bank",
      label: "Bank",
      options: distinctValues(rows, (r) => r.bankName).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.bankName === v,
    },
    {
      key: "accountType",
      label: "Account Type",
      options: distinctValues(rows, (r) => r.accountType).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.accountType === v,
    },
    {
      key: "primary",
      label: "Primary",
      options: [
        { value: "yes", label: "Primary account" },
        { value: "no", label: "Secondary account" },
      ],
      matches: (r, v) => (v === "yes" ? r.isPrimary : !r.isPrimary),
    },
  ];

  const sorts: SortDef<ClientBankRow>[] = [
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
      value: "bank",
      label: "Bank Name A–Z",
      compare: (a, b) => (a.bankName ?? "").localeCompare(b.bankName ?? ""),
    },
    {
      // Primary first, then by company — the account most people actually
      // want to look up, at the top.
      value: "primary",
      label: "Primary First",
      compare: (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) || a.company.localeCompare(b.company),
    },
  ];

  if (view === "grid") {
    return (
      <MasterGrid
        rows={rows}
        columns={gridColumns}
        title="Client Bank Master"
        primaryKey="company"
        primarySearchLabel="Search company"
        accent={KYC_ACCENT}
        accentSoft={KYC_ACCENT_SOFT}
        toolbar={viewSwitch}
        save={saveGridRow}
        noun="accounts"
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
        title="Client Bank Master"
        countNoun="accounts"
        searchPlaceholder="Search company, code, bank, account no…"
        csvName="client-bank-master"
        exportLabel="Export"
        selectable
        rowDetail
        onBulkDelete={removeSelected}
        deleteNoun="bank account"
        onEdit={(r) => setEditing(r)}
        rowDetailTitle={(r) => r.accountName ?? r.company}
        accent={KYC_ACCENT}
        fullscreen
        tintHeader
        emptyTitle="No bank accounts yet."
        emptySub="Accounts appear here as soon as a client is onboarded with one."
      />

      {editing && (
        <RecordEditDialog
          title={editing.accountName ?? editing.company}
          fields={EDIT_FIELDS}
          initial={{
            accountName: editing.accountName ?? "",
            bankName: editing.bankName ?? "",
            accountNo: editing.accountNo ?? "",
            ifscSwift: editing.ifscSwift ?? "",
            branch: editing.branch ?? "",
            accountType: editing.accountType ?? "",
            isPrimary: editing.isPrimary,
          }}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
