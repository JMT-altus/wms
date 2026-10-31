import Link from "next/link";
import type { ListParams } from "@/lib/tally/list-params";
import { BATCH_ROW_STATUSES, type BatchDetail, type BatchRowRow, type BatchRowSort, type Page } from "@/lib/queries/tally-ledger";
import { TALLY_CATEGORIES, type TallyCategoryKey } from "@/lib/tally/categories";
import { batchHref, recordHref, sectionForCategory } from "@/lib/tally/sections";
import { Card, Dash, EmptyState, FilterBar, Pagination, ResultCount, SortTh, StatusPill, StoragePending, Th } from "./ui";

/**
 * Every row one import recorded — imported, skipped, rejected and failed
 * alike — with the file's own cells, the reason where there is one, and for an
 * imported row the Forms section that now shows the record. `tally_import_rows`
 * is the audit the import wrote; nothing here re-reads the file or re-decides
 * anything.
 */
export function BatchRows({ detail, page, params }: { detail: BatchDetail; page: Page<BatchRowRow>; params: ListParams<BatchRowSort> }) {
  const base = batchHref(detail.batch.id);
  const category = detail.batch.category as TallyCategoryKey;
  const section = sectionForCategory(category, detail.batch.direction);
  const headers = detail.batch.headers;
  // The mapped columns first, in the category's field order, then the rest of the file.
  const mapped = Object.entries(detail.batch.mapping)
    .map(([key, col]) => ({ key, col, label: TALLY_CATEGORIES[category]?.fields.find((f) => f.key === key)?.label ?? key }))
    .sort((a, b) => a.col - b.col);
  const mappedCols = new Set(mapped.map((m) => m.col));
  const extra = headers.map((h, i) => ({ col: i, label: h })).filter((c) => !mappedCols.has(c.col));
  const columns = [...mapped.map((m) => ({ col: m.col, label: m.label, mapped: true })), ...extra.map((c) => ({ ...c, mapped: false }))];
  if (!page.storageReady) return <StoragePending />;
  return (
    <Card>
      <FilterBar base={base} params={params} spec={{ search: "Any cell in the row", statuses: BATCH_ROW_STATUSES }} />
      <ResultCount total={page.total} params={params} noun={page.total === 1 ? "row" : "rows"} />
      {page.total === 0 ? (
        <EmptyState title={params.q || params.status ? "No rows match these filters." : "No rows were recorded for this import."} body={params.q || params.status ? "Clear the filters to see every row." : detail.batch.status === "running" ? "The import is still running, or was interrupted before any row was saved. Upload the same file again to resume it." : "The import finished without recording any rows."} />
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Import rows" className="w-full text-[12.5px]" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <SortTh base={base} params={params} sort="rowNo" label="Row" />
                <SortTh base={base} params={params} sort="status" label="Status" />
                <Th>Destination</Th>
                <Th>Reason</Th>
                {columns.map((c) => (
                  <th key={c.col} className={`px-2 py-1.5 text-left font-semibold whitespace-nowrap ${c.mapped ? "text-ink-strong" : "text-ink-subtle"}`} title={c.mapped ? `Mapped column (file heading: ${headers[c.col] ?? ""})` : "Not mapped"}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((r) => {
                const href = r.status === "imported" ? recordHref(r.targetTable, r.targetId, detail.batch) : null;
                return (
                  <tr key={r.id} className="border-t border-hairline align-top">
                    <td className="px-2 py-1.5 tabular-nums">{r.rowNo}</td>
                    <td className="px-2 py-1.5">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {href ? (
                        <Link href={href} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">
                          {section.label} →
                        </Link>
                      ) : r.status === "skipped" && r.targetId ? (
                        <span className="text-ink-muted">Already in {section.label}</span>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-ink-muted" style={{ minWidth: 200 }}>
                      {r.reason ?? <Dash />}
                    </td>
                    {columns.map((c) => (
                      <td key={c.col} className="px-2 py-1.5 max-w-[260px] truncate" title={r.cells[c.col] ?? ""}>
                        {r.cells[c.col] || <Dash />}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base={base} params={params} total={page.total} />
    </Card>
  );
}
