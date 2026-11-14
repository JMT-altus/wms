import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFormsViewer } from "@/lib/auth/forms-access";
import { getDocument } from "@/lib/queries/tally-ledger";
import { loadSalesOrderCatalogue } from "@/lib/queries/sales-order-fields";
import { DOCUMENT_SECTIONS, FORMS_ROUTES, documentHref, isDocumentType, vendorHref } from "@/lib/tally/sections";
import { SalesOrderDetailsView, isSalesOrderDetails } from "@/components/forms/tally/sales-order-details";
import { TALLY_CATEGORIES } from "@/lib/tally/categories";
import { BatchSource, Card, Dash, KeyValues, Money, SectionHead, fmtDay, fmtWhen } from "@/components/forms/tally/ui";
import { SalesOrderPreClose } from "@/components/forms/tally/sales-order-preclose";
import { listPreClosures } from "@/lib/queries/sales-order-preclosures";
import { canPreCloseSalesOrders } from "@/lib/auth/sales-order-preclose";
import { getCurrentEmployee } from "@/lib/auth/current";
import { deliveriesOf } from "@/lib/tally/sales-order-preclose";
import { BASE_CATALOGUE, isRequired, preCloseFields } from "@/lib/tally/sales-order-config";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One imported voucher, complete: every stored field, its item lines, the
 * party it was linked to, the document it refers to and those that refer to
 * it, and the import batch it came from. The type in the URL must match the
 * stored `document_type`, so an id can't be viewed under the wrong ledger.
 */
export default async function DocumentPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const viewer = await requireFormsViewer();
  const { type, id } = await params;
  if (!isDocumentType(type) || !UUID.test(id)) notFound();
  // A Sales Order is shown with the field labels of Admin & Master Setup → Sales Order Fields (the matrix as it is before 0128).
  const [found, fields] = await Promise.all([getDocument(viewer, type, id), type === "sales-orders" ? loadSalesOrderCatalogue() : Promise.resolve(null)]);
  if (!found) notFound();
  // A Sales Order's deliveries can be pre-closed (the matrix's "Update" fields): its pre-closures (migration 0129) and
  // whether this employee may record one.
  const [preClosures, canPreClose] = type === "sales-orders" ? await Promise.all([listPreClosures(id), getCurrentEmployee().then(canPreCloseSalesOrders)]) : [null, false];
  const preCloseLabels = (() => {
    const f = new Map(preCloseFields(fields?.catalogue ?? BASE_CATALOGUE).map((x) => [x.key, x]));
    const reason = f.get("preCloseReason");
    return { quantity: f.get("preCloseQuantity")?.label ?? "Pre-Close Quantity", reason: reason?.label ?? "Reason for Pre-Close", date: f.get("preCloseDate")?.label ?? "Pre-Close Date", reasonRequired: !!reason && isRequired(reason, () => null) };
  })();
  const { document: d, party, batch, refersTo, referencedBy } = found;
  const def = DOCUMENT_SECTIONS[type];
  // Orders from the Sales Order import carry each line's product match, unit and due date.
  const linked = d.lines.some((l) => l.productLabel || l.uom || l.dueDate);
  const refLink = (r: { id: string; documentType: string; documentNo: string; documentDate: string; totalPaise: number }) =>
    isDocumentType(r.documentType) ? (
      <Link key={r.id} href={documentHref(r.documentType, r.id)} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">
        {DOCUMENT_SECTIONS[r.documentType].label.replace(/s$/, "")} {r.documentNo} · {fmtDay(r.documentDate)} · <Money paise={r.totalPaise} />
      </Link>
    ) : (
      <span key={r.id}>{r.documentNo}</span>
    );

  return (
    <div>
      <SectionHead eyebrow={`Forms · Tally ledgers · ${def.label}`} title={d.documentNo} lede={`${TALLY_CATEGORIES[type].label.replace(/ \/.*$/, "")} dated ${fmtDay(d.documentDate)} · ${d.partyName}`} back={{ href: def.href, label: def.label }} />
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        <KeyValues
          title="Document"
          items={[
            ["Type", TALLY_CATEGORIES[type].label],
            ["Document number", d.documentNo],
            ["Date", fmtDay(d.documentDate)],
            ["Financial year", `${d.financialYear}${d.isHistorical ? " (historical)" : ""}`],
            [def.amountLabel, <Money key="t" paise={d.totalPaise} strong />],
            ...(def.settlement ? ([["Payment mode", d.paymentMode], ["Reference", d.referenceNo]] as const) : ([["Taxable value", <Money key="x" paise={d.taxablePaise} />], ["Tax", <Money key="y" paise={d.taxPaise} />], ["Due date", fmtDay(d.dueDate)]] as const)),
            ...(d.adjustmentType ? ([[type === "sales-orders" ? "Voucher type" : "Adjustment type", d.adjustmentType]] as const) : []),
            ...(type === "sales-orders" && d.referenceNo ? ([["Customer order no.", d.referenceNo]] as const) : []),
            ...(def.refLabel ? ([[def.refLabel, refersTo ? refLink(refersTo) : d.refDocumentNo ? `${d.refDocumentNo} (not found among imported documents)` : null]] as const) : []),
            ["Narration", d.narration],
            ["Recorded", fmtWhen(d.createdAt)],
          ]}
        />
        <div className="flex flex-col gap-4">
          <KeyValues
            title={def.party === "vendor" ? "Vendor" : "Customer"}
            items={[
              ["Name on voucher", d.partyName],
              ["GSTIN on voucher", d.partyGstin],
              [
                "Linked to",
                party ? (
                  party.kind === "vendor" ? (
                    <Link href={vendorHref(party.id)} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">
                      {party.name}
                      {party.code ? ` · ${party.code}` : ""} (Vendor Master)
                    </Link>
                  ) : (
                    <Link href={FORMS_ROUTES.customerMaster} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">
                      {party.name}
                      {party.code ? ` · ${party.code}` : ""} (Customer Master)
                    </Link>
                  )
                ) : (
                  <span className="text-amber-700 font-semibold">Not linked — no matching {def.party} in the WMS masters when this was imported.</span>
                ),
              ],
              ...(party?.gstin ? ([["Master GSTIN", party.gstin]] as const) : []),
            ]}
          />
          <BatchSource batch={batch} categoryLabel={TALLY_CATEGORIES[type].label} />
          {batch && <p className="text-[12px] text-ink-subtle -mt-2 px-1">Source row {d.sourceRow} of the file.</p>}
        </div>
      </div>

      {type === "sales-orders" && isSalesOrderDetails(d.details) && <SalesOrderDetailsView details={d.details} lines={d.lines} catalogue={fields?.catalogue} />}
      {type === "sales-orders" && preClosures && isSalesOrderDetails(d.details) && (
        <SalesOrderPreClose
          documentId={d.id}
          deliveries={deliveriesOf(d.lines)}
          records={preClosures.records}
          ready={preClosures.ready}
          canPreClose={canPreClose}
          cancelled={d.details.states.cancelled}
          labels={preCloseLabels}
        />
      )}

      {d.lines.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 font-bold text-ink-strong" style={{ fontSize: 15 }}>
            Item lines
          </h2>
          <div className="overflow-x-auto">
            <table aria-label="Item lines" className="w-full text-[12.5px]" style={{ minWidth: linked ? 860 : 560 }}>
              <thead>
                <tr className="text-left text-ink-subtle">
                  <th className="px-2 py-1 font-semibold">#</th>
                  <th className="px-2 py-1 font-semibold">Item</th>
                  {linked && <th className="px-2 py-1 font-semibold">Product Master</th>}
                  <th className="px-2 py-1 font-semibold text-right">Quantity</th>
                  {linked && <th className="px-2 py-1 font-semibold">Unit</th>}
                  <th className="px-2 py-1 font-semibold text-right">Rate</th>
                  {linked && <th className="px-2 py-1 font-semibold">Due</th>}
                  <th className="px-2 py-1 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l, i) => (
                  <tr key={i} className="border-t border-hairline align-top">
                    <td className="px-2 py-1 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1">
                      {l.item ?? <Dash />}
                      {l.description && <span className="block text-[11.5px] text-ink-subtle">{l.description}</span>}
                    </td>
                    {linked && <td className="px-2 py-1">{l.productLabel ?? <Dash />}</td>}
                    <td className="px-2 py-1 text-right tabular-nums">{l.quantity ?? <Dash />}</td>
                    {linked && <td className="px-2 py-1">{l.uom ?? <Dash />}</td>}
                    <td className="px-2 py-1 text-right">
                      <Money paise={l.ratePaise} />
                    </td>
                    {linked && <td className="whitespace-nowrap px-2 py-1">{fmtDay(l.dueDate)}</td>}
                    <td className="px-2 py-1 text-right">
                      <Money paise={l.amountPaise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {referencedBy.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 font-bold text-ink-strong" style={{ fontSize: 15 }}>
            Referred to by
          </h2>
          <ul className="flex flex-col gap-1 text-[13.5px]">
            {referencedBy.map((r) => (
              <li key={r.id}>{refLink(r)}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
