import Link from "next/link";
import type { Route } from "next";
import type { ListParams } from "@/lib/tally/list-params";
import { listHref } from "@/lib/tally/list-params";
import type { OutstandingPage, OutstandingSort } from "@/lib/queries/tally-ledger";
import { FORMS_ROUTES, OUTSTANDING_VIEWS, outstandingHref, outstandingLineHref, vendorHref, type OutstandingView } from "@/lib/tally/sections";
import { Card, Dash, EmptyState, FilterBar, Money, Pagination, ResultCount, SortTh, StatusPill, StoragePending, Th, fmtDay, fmtWhen, shortId } from "./ui";

/**
 * Outstanding Balances, one side at a time, from `tally_outstanding_lines`.
 * A snapshot is one import batch (as-of date + direction); the page shows ONE
 * snapshot — the newest completed, or the one chosen — and says which, with
 * every other completed snapshot a click away. Lines from different snapshots
 * are never added together.
 */
export function OutstandingList({ view, page, params }: { view: OutstandingView; page: OutstandingPage; params: ListParams<OutstandingSort> }) {
  const def = OUTSTANDING_VIEWS[view];
  const base = outstandingHref(view);
  const other = view === "receivables" ? "payables" : "receivables";
  const filtered = Boolean(params.q || params.from || params.to);
  if (!page.storageReady) return <StoragePending />;
  const snap = page.snapshot;
  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-[13px] font-bold" role="tablist" aria-label="Side of the ledger">
        {(["receivables", "payables"] as const).map((v) => (
          <Link key={v} href={outstandingHref(v)} role="tab" aria-selected={v === view} className="rounded-pill px-4 py-1.5" style={v === view ? { background: "linear-gradient(135deg, #FB7185 0%, #BE123C 100%)", color: "#fff" } : { border: "1px solid var(--color-hairline-strong)", color: "var(--color-ink-soft)" }}>
            {OUTSTANDING_VIEWS[v].label}
          </Link>
        ))}
      </div>

      <Card className="mb-4">
        <h2 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
          Snapshot shown
        </h2>
        {snap ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13.5px]" aria-label="Snapshot">
            <p>
              <span className="text-ink-subtle font-semibold">As of</span> <strong className="text-ink-strong">{fmtDay(snap.asOfDate)}</strong>
            </p>
            <p>
              <span className="text-ink-subtle font-semibold">Imported</span> {fmtWhen(snap.completedAt ?? snap.createdAt)}
              {snap.uploadedBy ? ` by ${snap.uploadedBy}` : ""}
            </p>
            <p>
              <span className="text-ink-subtle font-semibold">File</span> {snap.fileName}
            </p>
            <p>
              <span className="text-ink-subtle font-semibold">Batch</span>{" "}
              <Link href={`/forms/tally-import/batches/${snap.id}` as Route} className="font-mono text-[12.5px] font-bold text-[#0B4FB8] underline-offset-2 hover:underline">
                {shortId(snap.id)}
              </Link>
            </p>
            <StatusPill status={snap.status} />
            {page.snapshots[0]?.id === snap.id ? <span className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-emerald-700">latest</span> : <span className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-amber-700">older snapshot</span>}
          </div>
        ) : (
          <p className="mt-1 text-[13.5px] text-ink-muted">No completed {def.label.toLowerCase()} snapshot has been imported.</p>
        )}
        {page.snapshots.length > 1 && (
          <form method="get" action={base} className="mt-3 flex items-end gap-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
            <label className="flex flex-col gap-1">
              Other snapshots
              <select name="batch" defaultValue={snap?.id ?? ""} className="h-9 rounded-lg border border-hairline-strong bg-white px-2 text-[13px] normal-case tracking-normal font-normal text-ink-strong">
                {page.snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    As of {fmtDay(s.asOfDate)} · {s.fileName} · {s.importedRows.toLocaleString("en-IN")} lines
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-9 rounded-lg border border-hairline-strong bg-white px-3 text-[13px] font-semibold normal-case tracking-normal text-ink-strong">
              Show
            </button>
          </form>
        )}
      </Card>

      <Card>
        {snap && <FilterBar base={listHref(base, { ...params, q: "", from: null, to: null, page: 1 })} params={params} spec={{ search: `${def.party === "vendor" ? "Vendor" : "Customer"} or bill reference`, dates: { label: "Bill date" } }} />}
        {snap && <input type="hidden" value={snap.id} readOnly aria-hidden />}
        <ResultCount
          total={page.total}
          params={params}
          noun={page.total === 1 ? "line" : "lines"}
          right={
            page.total > 0 && (
              <p className="font-semibold text-ink-muted">
                Pending, all {page.total.toLocaleString("en-IN")} shown: <Money paise={page.pendingPaise} strong />
              </p>
            )
          }
        />
        {page.total === 0 ? (
          <EmptyState
            title={!snap ? `No ${def.label.toLowerCase()} snapshot yet.` : filtered ? "No lines match these filters." : "This snapshot has no lines."}
            body={!snap ? `Import an Outstanding Balances file with the direction set to ${def.direction} in Tally Data Import. The newest completed snapshot is shown here.` : filtered ? "Clear the filters to see every line in this snapshot." : "The import recorded no lines for this snapshot."}
            cta={!snap ? { href: FORMS_ROUTES.tallyImport, label: "Open Tally Data Import" } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table aria-label={`Outstanding ${def.label}`} className="w-full text-[12.5px]" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <SortTh base={base} params={params} sort="partyName" label={def.party === "vendor" ? "Vendor" : "Customer"} />
                  <SortTh base={base} params={params} sort="billRef" label="Bill reference" />
                  <SortTh base={base} params={params} sort="billDate" label="Bill date" />
                  <SortTh base={base} params={params} sort="dueDate" label="Due date" />
                  <SortTh base={base} params={params} sort="originalPaise" label="Original" align="right" />
                  <SortTh base={base} params={params} sort="pendingPaise" label="Outstanding" align="right" />
                  <Th>Dr / Cr</Th>
                  <Th>FY</Th>
                  <Th>As of</Th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((l) => (
                  <tr key={l.id} className="border-t border-hairline align-top">
                    <td className="px-2 py-1.5">
                      <Link href={outstandingLineHref(view, l.id)} className="font-bold text-ink-strong underline-offset-2 hover:underline">
                        {l.partyName}
                      </Link>
                      {l.vendorMasterId && (
                        <Link href={vendorHref(l.vendorMasterId)} className="ml-2 text-[11.5px] text-ink-subtle underline-offset-2 hover:underline">
                          vendor
                        </Link>
                      )}
                      {!l.vendorMasterId && !l.customerMasterId && <span className="ml-2 text-[11px] font-bold uppercase text-amber-700">unlinked</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[12px]">{l.billRef ?? <Dash />}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{fmtDay(l.billDate)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{fmtDay(l.dueDate)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Money paise={l.originalPaise} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Money paise={l.pendingPaise} strong />
                    </td>
                    <td className="px-2 py-1.5">{l.direction === "receivable" ? "Dr (owed to us)" : "Cr (we owe)"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{financialYearOf(l.billDate ?? l.asOfDate)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{fmtDay(l.asOfDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination base={base} params={params} total={page.total} />
        <p className="mt-3 text-[12px] text-ink-subtle">
          Looking for the other side? <Link href={outstandingHref(other)} className="font-semibold underline-offset-2 hover:underline">{OUTSTANDING_VIEWS[other].label}</Link>.
        </p>
      </Card>
    </>
  );
}

/** Indian financial year (April–March) of a yyyy-mm-dd, e.g. "2025-26". */
export function financialYearOf(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
