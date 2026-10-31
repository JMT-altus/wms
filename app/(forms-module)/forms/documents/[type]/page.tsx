import { notFound } from "next/navigation";
import { requireFormsViewer } from "@/lib/auth/forms-access";
import { DOCUMENT_SORTS, batchOptions, documentFinancialYears, listDocuments } from "@/lib/queries/tally-ledger";
import { readListParams, type SearchParams } from "@/lib/tally/list-params";
import { DOCUMENT_SECTIONS, isDocumentType } from "@/lib/tally/sections";
import { TALLY_CATEGORIES } from "@/lib/tally/categories";
import { SectionHead } from "@/components/forms/tally/ui";
import { DocumentList } from "@/components/forms/tally/document-list";

export const dynamic = "force-dynamic";

/**
 * One document ledger — /forms/documents/sales-orders, …/sales-invoices, and
 * so on for the seven voucher categories. The segment IS the `document_type`
 * the query filters on, so each page shows one category and only that one.
 * Forms module access is the gate, checked by the layout and again here.
 */
export default async function DocumentLedgerPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<SearchParams> }) {
  const viewer = await requireFormsViewer();
  const { type } = await params;
  if (!isDocumentType(type)) notFound();
  const def = DOCUMENT_SECTIONS[type];
  const list = readListParams(await searchParams, DOCUMENT_SORTS, { sort: "documentDate", dir: "desc" });
  const [page, financialYears, batches] = await Promise.all([listDocuments(viewer, type, list), documentFinancialYears(viewer, type), batchOptions(viewer, type)]);
  return (
    <div>
      <SectionHead eyebrow="Forms · Tally ledgers" title={TALLY_CATEGORIES[type].label} lede={`${def.hint}. Imported through Tally Data Import → ${def.label}; each document links to its ${def.party} and to the import that recorded it.`} />
      <DocumentList type={type} page={page} params={list} financialYears={financialYears} batches={batches} />
    </div>
  );
}
