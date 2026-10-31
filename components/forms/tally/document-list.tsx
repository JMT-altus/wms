import Link from "next/link";
import type { ListParams } from "@/lib/tally/list-params";
import type { BatchOption, DocumentPage, DocumentSort } from "@/lib/queries/tally-ledger";
import { DOCUMENT_SECTIONS, FORMS_ROUTES, documentHref, vendorHref } from "@/lib/tally/sections";
import type { TallyDocumentType } from "@/lib/tally/categories";
import { Card, Dash, EmptyState, FilterBar, Money, Pagination, ResultCount, SortTh, StoragePending, Th, fmtDay } from "./ui";

/**
 * One document ledger (sales orders, sales invoices, …) over `tally_documents`,
 * filtered to exactly one `document_type`. The columns follow the schema: every
 * voucher has a number, date, party, financial year and total; taxable value,
 * tax, a referenced document, due date, payment mode and reference are shown
 * where the type carries them. Amounts are the stored paise — nothing is
 * computed except the filtered total, which the database sums.
 */
export function DocumentList({ type, page, params, financialYears, batches }: { type: TallyDocumentType; page: DocumentPage; params: ListParams<DocumentSort>; financialYears: string[]; batches: BatchOption[] }) {
  const def = DOCUMENT_SECTIONS[type];
  const base = def.href;
  const filtered = Boolean(params.q || params.fy || params.from || params.to || params.batch);
  if (!page.storageReady) return <StoragePending />;
  return (
    <Card>
      <FilterBar base={base} params={params} spec={{ search: "Document no. or party", financialYears, dates: { label: "Dated" }, batches }} />
      <ResultCount
        total={page.total}
        params={params}
        noun={page.total === 1 ? "document" : "documents"}
        right={
          page.total > 0 && (
            <p className="font-semibold text-ink-muted">
              {def.amountLabel}, all {page.total.toLocaleString("en-IN")} shown: <Money paise={page.totalPaise} strong />
            </p>
          )
        }
      />
      {page.total === 0 ? (
        <EmptyState
          title={filtered ? `No ${def.label.toLowerCase()} match these filters.` : `No ${def.label.toLowerCase()} yet.`}
          body={filtered ? "Clear the filters to see every record in this ledger." : `${def.label} arrive through Tally Data Import → ${def.label}. Each imported voucher then appears here, linked to its party and its batch.`}
          cta={{ href: FORMS_ROUTES.tallyImport, label: "Open Tally Data Import" }}
        />
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={def.label} className="w-full text-[12.5px]" style={{ minWidth: 1040 }}>
            <thead>
              <tr>
                <SortTh base={base} params={params} sort="documentNo" label="Document no." />
                <SortTh base={base} params={params} sort="documentDate" label="Date" />
                <SortTh base={base} params={params} sort="partyName" label={def.party === "vendor" ? "Vendor" : "Customer"} />
                <Th>GSTIN</Th>
                <Th>FY</Th>
                <SortTh base={base} params={params} sort="totalPaise" label={def.amountLabel} align="right" />
                {!def.settlement && <Th align="right">Taxable</Th>}
                {!def.settlement && <Th align="right">Tax</Th>}
                {def.settlement && <Th>Mode</Th>}
                {def.settlement && <Th>Reference</Th>}
                {def.refLabel && <Th>{def.refLabel}</Th>}
                {!def.settlement && <SortTh base={base} params={params} sort="dueDate" label="Due" />}
                {!def.settlement && <Th align="right">Lines</Th>}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((d) => (
                <tr key={d.id} className="border-t border-hairline align-top">
                  <td className="px-2 py-1.5 font-mono text-[12px]">
                    <Link href={documentHref(type, d.id)} className="font-bold text-ink-strong underline-offset-2 hover:underline">
                      {d.documentNo}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">{fmtDay(d.documentDate)}</td>
                  <td className="px-2 py-1.5">
                    {d.vendorMasterId ? (
                      <Link href={vendorHref(d.vendorMasterId)} className="underline-offset-2 hover:underline">
                        {d.partyName}
                      </Link>
                    ) : d.customerMasterId ? (
                      <Link href={FORMS_ROUTES.customerMaster} className="underline-offset-2 hover:underline">
                        {d.partyName}
                      </Link>
                    ) : (
                      <span title="No matching party in the WMS masters">
                        {d.partyName} <span className="text-[11px] font-bold uppercase text-amber-700">unlinked</span>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[12px]">{d.partyGstin ?? <Dash />}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {d.financialYear}
                    {d.isHistorical && <span className="ml-1 text-[11px] text-ink-subtle">· historical</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Money paise={d.totalPaise} strong />
                  </td>
                  {!def.settlement && (
                    <td className="px-2 py-1.5 text-right">
                      <Money paise={d.taxablePaise} />
                    </td>
                  )}
                  {!def.settlement && (
                    <td className="px-2 py-1.5 text-right">
                      <Money paise={d.taxPaise} />
                    </td>
                  )}
                  {def.settlement && <td className="px-2 py-1.5">{d.paymentMode ?? <Dash />}</td>}
                  {def.settlement && <td className="px-2 py-1.5">{d.referenceNo ?? <Dash />}</td>}
                  {def.refLabel && (
                    <td className="px-2 py-1.5 font-mono text-[12px]">
                      {d.refDocumentId && TALLY_REF_TYPE[type] ? (
                        <Link href={documentHref(TALLY_REF_TYPE[type]!, d.refDocumentId)} className="underline-offset-2 hover:underline">
                          {d.refDocumentNo}
                        </Link>
                      ) : (
                        d.refDocumentNo ?? <Dash />
                      )}
                    </td>
                  )}
                  {!def.settlement && <td className="whitespace-nowrap px-2 py-1.5">{fmtDay(d.dueDate)}</td>}
                  {!def.settlement && <td className="px-2 py-1.5 text-right tabular-nums">{d.lineCount}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base={base} params={params} total={page.total} />
    </Card>
  );
}

/** Which ledger a type's referenced document lives in (from TALLY_CATEGORIES.refersTo). */
const TALLY_REF_TYPE: Partial<Record<TallyDocumentType, TallyDocumentType>> = {
  "sales-invoices": "sales-orders",
  "credit-notes": "sales-invoices",
  "debit-notes": "purchase-invoices",
  "customer-receipts": "sales-invoices",
  "vendor-payments": "purchase-invoices",
};
