import { requireFormsViewer } from "@/lib/auth/forms-access";
import { VENDOR_SORTS, batchOptions, listVendors } from "@/lib/queries/tally-ledger";
import { readListParams, type SearchParams } from "@/lib/tally/list-params";
import { SectionHead } from "@/components/forms/tally/ui";
import { VendorList } from "@/components/forms/tally/vendor-list";

export const dynamic = "force-dynamic";

/**
 * Vendor Master — every vendor in `vendor_masters`, which Tally Data Import →
 * Vendor Master fills. Read-only: there is no vendor form in the WMS, so a
 * vendor is corrected by fixing it in Tally and importing again (a repeat
 * import of the same vendor adds nothing). Forms module access is the gate,
 * checked by the layout and again here before the query runs.
 */
export default async function VendorMasterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await requireFormsViewer();
  const params = readListParams(await searchParams, VENDOR_SORTS, { sort: "name", dir: "asc" });
  const [page, batches] = await Promise.all([listVendors(viewer, params), batchOptions(viewer, "vendor-master")]);
  return (
    <div>
      <SectionHead eyebrow="Forms · Masters" title="Vendor Master" lede="Vendors brought in from Tally, with their GSTIN, PAN, contact details and the import that added them." />
      <VendorList page={page} params={params} batches={batches} />
    </div>
  );
}
