import Link from "next/link";
import { notFound } from "next/navigation";
import { FileUp } from "lucide-react";
import { getCurrentEmployee } from "@/lib/auth/current";
import { requireFormsViewer } from "@/lib/auth/forms-access";
import { DOCUMENT_SORTS, batchOptions, documentFinancialYears, listDocuments } from "@/lib/queries/tally-ledger";
import { readListParams, type SearchParams } from "@/lib/tally/list-params";
import { DOCUMENT_SECTIONS, isDocumentType, salesOrderImportHref } from "@/lib/tally/sections";
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
  const [page, financialYears, batches, me] = await Promise.all([listDocuments(viewer, type, list), documentFinancialYears(viewer, type), batchOptions(viewer, type), getCurrentEmployee()]);
  // The import screen itself needs admin (and the import permission to do anything): the button only saves a click.
  const importHref = type === "sales-orders" && me?.isAdmin ? salesOrderImportHref : null;
  return (
    <div>
      <SectionHead
        eyebrow="Forms · Tally ledgers"
        title={TALLY_CATEGORIES[type].label}
        lede={
          type === "sales-orders"
            ? `${def.hint}. Imported from Tally's Sales Order Excel format; each order keeps its product lines and links to its customer and to the import that recorded it.`
            : `${def.hint}. Imported through Tally Data Import → ${def.label}; each document links to its ${def.party} and to the import that recorded it.`
        }
        right={
          importHref && (
            <Link href={importHref} className="inline-flex items-center gap-2 rounded-pill px-4 py-2.5 text-[13.5px] font-bold text-white" style={{ background: "linear-gradient(135deg, #0A6CFF 0%, #0B4FB8 100%)" }}>
              <FileUp size={16} strokeWidth={2.3} aria-hidden /> Import Sales Orders
            </Link>
          )
        }
      />
      <DocumentList type={type} page={page} params={list} financialYears={financialYears} batches={batches} importHref={importHref} />
    </div>
  );
}
