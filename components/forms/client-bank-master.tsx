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
import {
  RecordEditDialog,
  type EditField,
  type EditValues,
} from "./kyc/record-edit-dialog";
import { KYC_ACCENT } from "./kyc/tokens";

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
export function ClientBankMaster({ rows }: { rows: ClientBankRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ClientBankRow | null>(null);

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
    { key: "bankName", label: "Bank Name", maxLength: 160 },
    { key: "accountNo", label: "Account No", maxLength: 60 },
    { key: "ifscSwift", label: "IFSC / SWIFT", maxLength: 30 },
    { key: "branch", label: "Branch", maxLength: 160 },
    { key: "accountType", label: "Account Type", maxLength: 40 },
    { key: "isPrimary", label: "Primary", type: "checkbox", placeholder: "This is the primary account" },
  ];

  async function saveEdit(v: EditValues) {
    if (!editing) return { ok: false as const, error: "Nothing to save." };
    const res = await updateClientBankAccount(editing.id, v);
    if (res.ok) router.refresh();
    return res;
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
      width: 190,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {r.accountName ? <strong className="text-ink-strong">{r.accountName}</strong> : <Dash />}
          {r.isPrimary && <TypePill label="Primary" strong />}
        </span>
      ),
      value: (r) => r.accountName ?? "",
    },
    {
      key: "bankName",
      header: "Bank Name",
      width: 170,
      render: (r) => r.bankName ?? <Dash />,
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
      width: 130,
      render: (r) => r.accountType ?? <Dash />,
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

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
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
