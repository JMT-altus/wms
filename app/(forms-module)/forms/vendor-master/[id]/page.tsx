import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFormsViewer } from "@/lib/auth/forms-access";
import { getVendor } from "@/lib/queries/tally-ledger";
import { DOCUMENT_SECTIONS, FORMS_ROUTES, outstandingHref } from "@/lib/tally/sections";
import { BatchSource, KeyValues, SectionHead, fmtWhen } from "@/components/forms/tally/ui";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One vendor: everything the import recorded, its source batch, and what in the ledgers names it. */
export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireFormsViewer();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const v = await getVendor(viewer, id);
  if (!v) notFound();
  return (
    <div>
      <SectionHead eyebrow="Forms · Masters · Vendor" title={v.name} lede={v.gstin ? `GSTIN ${v.gstin}` : "No GSTIN on record"} back={{ href: FORMS_ROUTES.vendorMaster, label: "Vendor Master" }} />
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        <KeyValues
          title="Vendor"
          items={[
            ["Name", v.name],
            ["Code / alias", v.code],
            ["GSTIN", v.gstin],
            ["PAN", v.panNo],
            ["Tally group", v.tallyGroup],
            ["Phone", v.phone],
            ["Email", v.email],
            ["Address", v.address],
            ["State", v.state],
            ["Credit period", v.creditPeriodDays === null ? null : `${v.creditPeriodDays} days`],
            ["Status", v.isActive ? "Active" : "Inactive"],
            ["Created", fmtWhen(v.createdAt)],
          ]}
        />
        <div className="flex flex-col gap-4">
          <BatchSource batch={v.batch} categoryLabel="Vendor Master" />
          <KeyValues
            title="In the ledgers"
            items={[
              ...v.documents.map((d) => [DOCUMENT_SECTIONS[d.type].label, <Link key={d.type} href={DOCUMENT_SECTIONS[d.type].href} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">{d.n.toLocaleString("en-IN")} · open ledger</Link>] as const),
              ...(v.documents.length === 0 ? ([["Documents", "None name this vendor yet."]] as const) : []),
              ["Payable outstanding lines", v.outstandingLines > 0 ? <Link key="o" href={outstandingHref("payables")} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">{v.outstandingLines.toLocaleString("en-IN")} across all snapshots · open Payables</Link> : "None"],
            ]}
          />
        </div>
      </div>
    </div>
  );
}
