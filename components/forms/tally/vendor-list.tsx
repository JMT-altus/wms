import Link from "next/link";
import type { ListParams } from "@/lib/tally/list-params";
import type { BatchOption, Page, VendorRow, VendorSort } from "@/lib/queries/tally-ledger";
import { FORMS_ROUTES, vendorHref } from "@/lib/tally/sections";
import { Card, Dash, EmptyState, FilterBar, Pagination, ResultCount, SortTh, StoragePending, Th, fmtWhen } from "./ui";

const BASE = FORMS_ROUTES.vendorMaster;

/** Vendor Master: every vendor Tally Data Import created, from `vendor_masters`. Read-only — vendors are edited by re-importing. */
export function VendorList({ page, params, batches }: { page: Page<VendorRow>; params: ListParams<VendorSort>; batches: BatchOption[] }) {
  if (!page.storageReady) return <StoragePending />;
  return (
    <Card>
      <FilterBar base={BASE} params={params} spec={{ search: "Name, code or GSTIN", dates: { label: "Imported" }, batches }} />
      <ResultCount total={page.total} params={params} noun={page.total === 1 ? "vendor" : "vendors"} />
      {page.total === 0 ? (
        <EmptyState
          title={params.q || params.batch || params.from || params.to ? "No vendors match these filters." : "No vendors yet."}
          body={params.q || params.batch || params.from || params.to ? "Clear the filters to see every vendor." : "Vendors arrive through Tally Data Import → Vendor Master. Each one then appears here with its GSTIN, contact details and the batch that brought it."}
          cta={{ href: FORMS_ROUTES.tallyImport, label: "Open Tally Data Import" }}
        />
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Vendor Master" className="w-full text-[12.5px]" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <SortTh base={BASE} params={params} sort="name" label="Vendor" />
                <SortTh base={BASE} params={params} sort="code" label="Code" />
                <Th>GSTIN</Th>
                <Th>PAN</Th>
                <Th>Phone</Th>
                <Th>Email</Th>
                <SortTh base={BASE} params={params} sort="state" label="State" />
                <Th>Tally group</Th>
                <Th>Source</Th>
                <SortTh base={BASE} params={params} sort="createdAt" label="Imported" />
              </tr>
            </thead>
            <tbody>
              {page.rows.map((v) => (
                <tr key={v.id} className="border-t border-hairline align-top">
                  <td className="px-2 py-1.5">
                    <Link href={vendorHref(v.id)} className="font-bold text-ink-strong underline-offset-2 hover:underline">
                      {v.name}
                    </Link>
                    {!v.isActive && <span className="ml-2 text-[11px] font-bold uppercase text-ink-subtle">inactive</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[12px]">{v.code ?? <Dash />}</td>
                  <td className="px-2 py-1.5 font-mono text-[12px]">{v.gstin ?? <Dash />}</td>
                  <td className="px-2 py-1.5 font-mono text-[12px]">{v.panNo ?? <Dash />}</td>
                  <td className="px-2 py-1.5">{v.phone ?? <Dash />}</td>
                  <td className="px-2 py-1.5">{v.email ?? <Dash />}</td>
                  <td className="px-2 py-1.5">{v.state ?? <Dash />}</td>
                  <td className="px-2 py-1.5">{v.tallyGroup ?? <Dash />}</td>
                  <td className="px-2 py-1.5">{v.importBatchId ? `Tally · ${v.batchFileName ?? "import"}` : "Added in WMS"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{fmtWhen(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base={BASE} params={params} total={page.total} />
    </Card>
  );
}
