"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PencilLine, RotateCcw, Trash2, UserCheck } from "lucide-react";
import {
  checkOutClientDraft,
  deleteClientsPermanently,
  onboardClientDrafts,
  recycleClientDrafts,
  restoreClientsFromRecycleBin,
} from "@/app/(forms-module)/forms/client-kyc/actions";
import {
  DRAFT_EXPIRY_DAYS,
  draftDaysLeft,
  kycCompletionPercent,
} from "@/lib/masters/kyc-completeness";
import type { ClientKycStageRow } from "@/lib/queries/client-kyc";
import {
  DataTable,
  Dash,
  type Column,
  type FilterDef,
  type SortDef,
} from "@/components/admin/master/data-table";
import { CodeCell } from "@/components/masters/row-menu";
import { TypePill, distinctValues } from "./kyc/master-list";
import { KYC_ACCENT } from "./kyc/tokens";

/**
 * The Draft and Recycle Bin lists.
 *
 * One component for both because they are the same records differing only in
 * stage and in which actions each offers. Built on the shared `DataTable` in
 * title mode, the same chrome as Client Master and the three directories —
 * search, filter chips, sort, Rows, Columns, selection, row details and full
 * screen — so all six Client KYC screens behave the same way.
 *
 * Export is the one thing these two deliberately do NOT offer; see the
 * `exportable` prop below.
 *
 * Every row still leads with what the record is missing. "Incomplete" tells a
 * user nothing; "needs a billing address" tells them where to go.
 */
/** The action-bar pill, shared by all four buttons so they stay identical. */
const pillClass =
  "inline-flex items-center gap-1.5 rounded-pill px-3 h-8 text-[13px] font-semibold " +
  "text-ink-soft bg-surface-card border border-hairline disabled:opacity-50 whitespace-nowrap";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function ClientKycStageList({
  mode,
  rows,
}: {
  mode: "draft" | "recycled";
  rows: ClientKycStageRow[];
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const isDraft = mode === "draft";

  /**
   * Restore — reopen one draft in the KYC form to finish it.
   *
   * Deliberately single-record: the form edits one client, so restoring a
   * multi-row selection has no meaning. The button reflects that by staying
   * disabled until exactly one row is picked, rather than silently acting on
   * the first of five.
   */
  function restoreToForm(selected: ClientKycStageRow[]) {
    if (selected.length !== 1) {
      toast.error("Pick one draft to restore — the form opens a single client at a time.");
      return;
    }
    const id = selected[0]!.id;
    start(async () => {
      // Check it out first, so the row leaves this list as the form opens and
      // the record is never in both places at once. A failure here is not a
      // reason to refuse to open the form — the draft simply stays listed.
      const res = await checkOutClientDraft(id).catch(() => null);
      if (res && !res.ok) toast.error(res.error);
      router.push(`/forms/client-kyc/new?draft=${id}`);
    });
  }

  /**
   * Onboard — push finished drafts into the Client Master.
   *
   * The server re-checks completeness and tells us which rows it refused, so
   * a partial run says exactly what is still missing on the ones that stayed
   * behind instead of reporting a clean success.
   */
  function onboard(selected: ClientKycStageRow[], clear: () => void) {
    start(async () => {
      try {
        const res = await onboardClientDrafts(selected.map((r) => r.id));
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        const n = res.onboarded ?? 0;
        const blocked = res.blocked ?? [];
        if (n > 0) {
          toast.success(
            `${n} ${n === 1 ? "client" : "clients"} onboarded to the Client Master.`,
          );
        }
        for (const b of blocked.slice(0, 3)) {
          toast.error(`${b.name} still needs ${b.missing.join(", ")}.`, { duration: 8000 });
        }
        if (blocked.length > 3) {
          toast.error(`…and ${blocked.length - 3} more still incomplete.`);
        }
        clear();
        router.refresh();
      } catch {
        toast.error("Couldn't reach the server. Try again in a moment.");
      }
    });
  }

  function run(
    action: (ids: string[]) => Promise<{ ok: true } | { ok: false; error: string }>,
    selected: ClientKycStageRow[],
    done: string,
    clear: () => void,
  ) {
    start(async () => {
      try {
        const res = await action(selected.map((r) => r.id));
        if (res.ok) {
          toast.success(`${selected.length} ${selected.length === 1 ? "record" : "records"} ${done}.`);
          clear();
          router.refresh();
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Couldn't reach the server. Try again in a moment.");
      }
    });
  }

  const columns: Column<ClientKycStageRow>[] = [
    {
      key: "code",
      header: "Client Code",
      width: 110,
      render: (r) => (r.code ? <CodeCell>{r.code}</CodeCell> : <Dash />),
      value: (r) => r.code ?? "",
    },
    {
      key: "name",
      header: "Company",
      width: 200,
      render: (r) => <strong className="text-ink-strong">{r.name}</strong>,
    },
    {
      key: "done",
      header: "Done",
      width: 90,
      // Progress against the five onboarding requirements, not against every
      // box on the form — see kycCompletionPercent. It answers "which of
      // these is nearly ready", which is what decides what to pick up next.
      render: (r) => {
        const pct = kycCompletionPercent(r.missing);
        return (
          <span className="flex items-center gap-1.5">
            <span
              className="rounded-pill overflow-hidden shrink-0"
              style={{ width: 34, height: 5, background: "var(--color-surface-soft)" }}
            >
              <span
                className="block h-full rounded-pill"
                style={{
                  width: `${pct}%`,
                  background: pct === 100 ? "var(--color-green)" : KYC_ACCENT,
                }}
              />
            </span>
            <span className="tabular-nums text-ink-soft" style={{ fontSize: 12 }}>
              {pct}%
            </span>
          </span>
        );
      },
      value: (r) => String(kycCompletionPercent(r.missing)),
    },
    {
      key: "missing",
      header: "Still Needs",
      width: 320,
      render: (r) =>
        r.missing.length === 0 ? (
          <TypePill label="Complete" />
        ) : (
          <span className="text-ink-soft">{r.missing.join(" · ")}</span>
        ),
      value: (r) => r.missing.join(" · "),
    },
    ...(isDraft
      ? [
          {
            key: "daysLeft",
            header: "Days Left",
            width: 110,
            // Only drafts run a clock. A recycled row's `draftSince` is
            // whatever it was when it expired, which would read as a
            // countdown that already ended.
            render: (r: ClientKycStageRow) => {
              if (!r.draftSince) return <Dash />;
              const left = draftDaysLeft(r.draftSince);
              return (
                <span
                  className="font-bold tabular-nums"
                  style={{ color: left <= 2 ? "var(--color-red)" : "var(--color-ink-soft)" }}
                >
                  {left === 0 ? "Today" : `${left} day${left === 1 ? "" : "s"}`}
                </span>
              );
            },
            value: (r: ClientKycStageRow) =>
              r.draftSince ? String(draftDaysLeft(r.draftSince)) : "",
          } satisfies Column<ClientKycStageRow>,
        ]
      : [
          {
            key: "recycledAt",
            header: "Recycled On",
            width: 120,
            render: (r: ClientKycStageRow) =>
              r.recycledAt ? <span className="tabular-nums">{formatDate(r.recycledAt)}</span> : <Dash />,
            value: (r: ClientKycStageRow) => formatDate(r.recycledAt),
          } satisfies Column<ClientKycStageRow>,
        ]),
    {
      key: "salesRepName",
      header: "Sales Co-ordinator",
      width: 160,
      render: (r) => r.salesRepName ?? <Dash />,
      value: (r) => r.salesRepName ?? "",
    },
    {
      key: "gstin",
      header: "GSTIN",
      width: 160,
      render: (r) =>
        r.gstin ? (
          <span
            className="text-ink-soft"
            style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 12 }}
          >
            {r.gstin}
          </span>
        ) : (
          <Dash />
        ),
      value: (r) => r.gstin ?? "",
    },
    {
      key: "city",
      header: "City",
      width: 130,
      render: (r) => r.city ?? <Dash />,
      value: (r) => r.city ?? "",
    },
    {
      key: "updatedAt",
      header: "Last Updated",
      width: 120,
      render: (r) => <span className="tabular-nums">{formatDate(r.updatedAt)}</span>,
      value: (r) => formatDate(r.updatedAt),
    },
    {
      key: "createdAt",
      header: "Created",
      width: 120,
      render: (r) => <span className="tabular-nums">{formatDate(r.createdAt)}</span>,
      value: (r) => formatDate(r.createdAt),
    },
  ];

  const filters: FilterDef<ClientKycStageRow>[] = [
    {
      key: "missing",
      label: "Missing",
      options: [
        { value: "contact", label: "A contact person" },
        { value: "address", label: "A billing address" },
        { value: "tax", label: "GSTIN or PAN" },
        { value: "rep", label: "Sales Co-ordinator" },
      ],
      matches: (r, v) => {
        const joined = r.missing.join(" ").toLowerCase();
        if (v === "contact") return joined.includes("contact person");
        if (v === "address") return joined.includes("billing address");
        if (v === "tax") return joined.includes("gstin or pan");
        return joined.includes("sales co-ordinator");
      },
    },
    {
      key: "salesRep",
      label: "Co-ordinator",
      options: distinctValues(rows, (r) => r.salesRepName).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.salesRepName === v,
    },
    {
      key: "city",
      label: "City",
      options: distinctValues(rows, (r) => r.city).map((n) => ({ value: n, label: n })),
      matches: (r, v) => r.city === v,
    },
    ...(isDraft
      ? [
          {
            key: "urgency",
            label: "Expiring",
            options: [
              { value: "soon", label: "2 days or less" },
              { value: "later", label: "More than 2 days" },
            ],
            matches: (r: ClientKycStageRow, v: string) => {
              if (!r.draftSince) return false;
              const left = draftDaysLeft(r.draftSince);
              return v === "soon" ? left <= 2 : left > 2;
            },
          } satisfies FilterDef<ClientKycStageRow>,
        ]
      : []),
  ];

  const sorts: SortDef<ClientKycStageRow>[] = [
    // Oldest first: the draft closest to being recycled is the one that needs
    // attention, so it should not be buried at the bottom.
    {
      value: "oldest",
      label: isDraft ? "Expiring First" : "Oldest First",
      compare: (a, b) => (a.draftSince ?? "").localeCompare(b.draftSince ?? ""),
    },
    {
      value: "updated",
      label: "Recently Updated",
      compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    },
    {
      value: "closest",
      label: "Closest to Done",
      compare: (a, b) => a.missing.length - b.missing.length || a.name.localeCompare(b.name),
    },
    { value: "name", label: "Company A–Z", compare: (a, b) => a.name.localeCompare(b.name) },
    { value: "name-desc", label: "Company Z–A", compare: (a, b) => b.name.localeCompare(a.name) },
    {
      value: "missing",
      label: "Most Missing",
      compare: (a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      filters={filters}
      sorts={sorts}
      title={isDraft ? "Draft" : "Recycle Bin"}
      countNoun={isDraft ? "drafts" : "records"}
      searchPlaceholder="Search company, code, GSTIN, city…"
      // No export here. These two screens are a to-do list and a bin — the
      // records in them are unfinished or on their way out, and a spreadsheet
      // of half-filled clients is not something anyone should be circulating.
      exportable={false}
      selectable
      rowDetail
      rowDetailTitle={(r) => r.name}
      fullscreen
      accent={KYC_ACCENT}
      tintHeader
      // The Recycle Bin is the only place a client can be destroyed for good;
      // Draft offers "Move to Recycle Bin" instead, which is reversible and
      // must not wear the "cannot be restored" warning.
      onBulkDelete={
        isDraft ? undefined : (selected) => deleteClientsPermanently(selected.map((r) => r.id))
      }
      deleteNoun="client"
      selectionActions={({ rows: selected, clear }) =>
        isDraft ? (
          <>
            {/* Restore first: finishing the record is the point of this
                screen, and the other two are what you do once you have. */}
            <button
              type="button"
              disabled={pending || selected.length !== 1}
              onClick={() => restoreToForm(selected)}
              title={
                selected.length === 1
                  ? "Open this draft in the KYC form"
                  : "Select a single draft to restore"
              }
              className={pillClass}
            >
              <PencilLine size={14} strokeWidth={2.3} className="shrink-0" />
              Restore
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onboard(selected, clear)}
              title="Move finished drafts into the Client Master"
              className={pillClass}
            >
              <UserCheck size={14} strokeWidth={2.3} className="shrink-0" />
              Onboarding
            </button>
            {/* Reversible by design — this is the Recycle Bin route, not a
                destroy. The toast says so, so "Delete" never reads as a lie. */}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(recycleClientDrafts, selected, "moved to the Recycle Bin", clear)}
              title="Move to the Recycle Bin — restorable from there"
              className={pillClass}
            >
              <Trash2 size={14} strokeWidth={2.3} className="shrink-0" />
              Delete
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(restoreClientsFromRecycleBin, selected, "restored", clear)}
            className={pillClass}
          >
            <RotateCcw size={14} strokeWidth={2.3} className="shrink-0" />
            Restore
          </button>
        )
      }
      emptyTitle={isDraft ? "No drafts" : "The Recycle Bin is empty"}
      emptySub={
        isDraft
          ? `Every client saved so far had everything it needed. Anything left here for ${DRAFT_EXPIRY_DAYS} days moves to the Recycle Bin on its own.`
          : `Drafts nobody finishes in ${DRAFT_EXPIRY_DAYS} days land here. Restore puts a record back where it belongs — Draft with a fresh ${DRAFT_EXPIRY_DAYS} days, or the Client Master if it is complete.`
      }
    />
  );
}
