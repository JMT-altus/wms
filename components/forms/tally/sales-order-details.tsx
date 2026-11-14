import type * as React from "react";
import { Card, Dash, KeyValues, Money, fmtDay } from "@/components/forms/tally/ui";
import type { SalesOrderDetails } from "@/lib/tally/sales-order-catalogue";
import type { TallyLine } from "@/lib/tally/plan";
import { BASE_CATALOGUE, STORED_PATH, displayValue, readPath, type SoCatalogue } from "@/lib/tally/sales-order-config";

/**
 * The rest of a Sales Order, as imported: every order-level field of Tally's
 * Sales Order matrix (stored in tally_documents.details, migration 0127) and
 * each product line's allocations, GST and HSN/SAC. Display only, labelled
 * with the matrix's own field names (or the label an administrator gave them in
 * Admin & Master Setup → Sales Order Fields).
 *
 * What is stored is always shown, whatever the configuration says now: a
 * retired field's value stays on the orders that have it, marked "retired".
 * Only a field an administrator took off the order page (and that is still
 * active) is left out.
 */

export const isSalesOrderDetails = (v: unknown): v is SalesOrderDetails => !!v && typeof v === "object" && (v as { version?: unknown }).version === 1;

const yes = (b: boolean) => (b ? "Yes" : "No");

type Row = readonly [string, React.ReactNode];

/** A field's heading on this page: its configured label (its Tally name by default), "retired" when it is. */
function heading(c: SoCatalogue, key: string): string | null {
  const f = c.byKey.get(key);
  if (!f) return key; // a custom field no longer in the configuration at all: its key, never dropped
  if (f.status === "active" && !f.onOrderPage) return null;
  const name = f.isCustom ? f.label : (f.setting?.label ?? f.tallyName);
  return f.status === "retired" ? `${name} (retired)` : name;
}

/** The order-level field rows of one group, read by their stored paths. */
function voucherRows(c: SoCatalogue, d: SalesOrderDetails, keys: readonly string[]): Row[] {
  const out: Row[] = [];
  for (const key of keys) {
    const h = heading(c, key);
    if (h === null) continue;
    const path = STORED_PATH[key]!;
    const v = readPath(d, path);
    out.push([h, key === "orderDate" ? fmtDay(typeof v === "string" ? v : null) : displayValue({ key, type: "text" }, v, path)]);
  }
  return out;
}

/**
 * Keyed values held at one scope (custom fields and the x fields the WMS offers), in the configuration's order, each by
 * its heading. `only`: just the matrix's ("tally") or just the custom ones; both by default.
 */
function customRows(c: SoCatalogue, custom: Readonly<Record<string, unknown>> | undefined, only?: "tally" | "custom"): Row[] {
  if (!custom) return [];
  const order = (k: string) => c.fields.findIndex((f) => f.key === k);
  const isTally = (k: string) => !!c.byKey.get(k) && !c.byKey.get(k)!.isCustom;
  return Object.keys(custom)
    .filter((k) => custom[k] !== null && custom[k] !== undefined && custom[k] !== "")
    .filter((k) => !only || (only === "tally") === isTally(k))
    .sort((a, b) => (order(a) < 0 ? 1e9 : order(a)) - (order(b) < 0 ? 1e9 : order(b)))
    .flatMap((k): Row[] => {
      const h = heading(c, k);
      // A date is stored yyyy-mm-dd and shown like every other date on the page.
      const v = custom[k];
      const shown = c.byKey.get(k)?.type === "date" && typeof v === "string" ? fmtDay(v) : displayValue({ key: k, type: "text" }, v, null);
      return h === null ? [] : [[h, shown]];
    });
}

const inline = (rows: Row[]) =>
  rows.map(([k, v]) => (
    <span key={k} className="block">
      {k}: {v}
    </span>
  ));

const VOUCHER_KEYS = ["voucherType", "seriesName", "narration", "costCentreClass", "gstRegistration", "voucherClass", "priceLevel", "supplyType", "referenceNo", "orderDate", "paymentTerms", "otherReferences", "deliveryTerms", "originalSalesNature"] as const;
const DISPATCH_KEYS = ["dispatchedThrough", "destination", "carrier", "isOptional", "isPostDated", "isCancelled", "changeMode"] as const;
const BUYER_KEYS = ["buyerBillTo", "buyerMailingName", "buyerAddressType", "buyerAddress", "buyerState", "buyerCountry", "buyerPincode", "gstin", "buyerRegType", "buyerBillOfEntry", "buyerSec7", "placeOfSupply"] as const;
const CONSIGNEE_KEYS = ["consignee", "consigneeMailingName", "consigneeAddressType", "consigneeAddress", "consigneeState", "consigneeCountry", "consigneePincode", "consigneeGstin"] as const;
const pct = (n: number | null) => (n === null ? null : `${n}%`);

export function SalesOrderDetailsView({ details: s, lines, catalogue: c = BASE_CATALOGUE }: { details: SalesOrderDetails; lines: readonly TallyLine[]; catalogue?: SoCatalogue }) {
  const orderTally = customRows(c, s.custom, "tally");
  const orderCustom = customRows(c, s.custom, "custom");
  const ledgerCustom = s.ledgers.some((l) => customRows(c, l.custom).length > 0);
  const lineCustom = lines.some((l) => customRows(c, l.custom).length > 0 || (l.allocations ?? []).some((a) => customRows(c, a.custom).length > 0));
  return (
    <>
      <div className="mt-4 grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        <KeyValues title="Voucher and order" items={voucherRows(c, s, VOUCHER_KEYS)} />
        <KeyValues title="Dispatch and voucher states" items={voucherRows(c, s, DISPATCH_KEYS)} />
        <KeyValues title="Buyer / Supplier" items={voucherRows(c, s, BUYER_KEYS)} />
        <KeyValues title={s.consignee.sameAsBuyer ? "Consignee (ship to) — same as the buyer" : "Consignee (ship to)"} items={voucherRows(c, s, CONSIGNEE_KEYS)} />
        {orderTally.length > 0 && <KeyValues title="Other Tally fields" items={orderTally} />}
        {orderCustom.length > 0 && <KeyValues title="Custom fields" items={orderCustom} />}
      </div>

      <Card className="mt-4">
        <h2 className="mb-2 font-bold text-ink-strong" style={{ fontSize: 15 }}>
          Ledger entries
        </h2>
        <div className="overflow-x-auto">
          <table aria-label="Ledger entries" className="w-full text-[12.5px]" style={{ minWidth: 820 }}>
            <thead>
              <tr className="text-left text-ink-subtle">
                <th className="px-2 py-1 font-semibold">Ledger Name</th>
                <th className="px-2 py-1 font-semibold">Dr/Cr</th>
                <th className="px-2 py-1 font-semibold text-right">Ledger Amount</th>
                <th className="px-2 py-1 font-semibold text-right">Ledger Rate</th>
                <th className="px-2 py-1 font-semibold">Ledger Narration</th>
                <th className="px-2 py-1 font-semibold">Description of Ledger</th>
                <th className="px-2 py-1 font-semibold">Cost centres</th>
                {ledgerCustom && <th className="px-2 py-1 font-semibold">Other fields</th>}
              </tr>
            </thead>
            <tbody>
              {s.ledgers.map((l, i) => (
                <tr key={i} className="border-t border-hairline align-top">
                  <td className="px-2 py-1 text-ink-strong">
                    {l.name}
                    {l.isParty && <span className="block text-[11px] text-ink-subtle">Customer (order total)</span>}
                    {l.listedAs && l.listedAs !== l.name && <span className="block text-[11px] text-ink-subtle">Listed as {l.listedAs}</span>}
                  </td>
                  <td className="px-2 py-1">{l.side ? l.side.replace(/^./, (c) => c.toUpperCase()) : <Dash />}</td>
                  <td className="px-2 py-1 text-right">
                    <Money paise={l.amountPaise} />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.rate}</td>
                  <td className="px-2 py-1">{l.narration}</td>
                  <td className="px-2 py-1">{l.description}</td>
                  <td className="px-2 py-1">
                    {l.costCentres.length === 0 ? (
                      <Dash />
                    ) : (
                      l.costCentres.map((c, j) => (
                        <span key={j} className="block">
                          {c.category ? `${c.category} · ` : ""}
                          {c.costCentre} · <Money paise={c.amountPaise} />
                        </span>
                      ))
                    )}
                  </td>
                  {ledgerCustom && <td className="px-2 py-1">{inline(customRows(c, l.custom))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.additionalCosts.length > 0 && (
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Additional cost:{" "}
            {s.additionalCosts.map((a, i) => (
              <span key={i}>
                {i > 0 && "; "}
                {a.ledger}
                {a.listedAs && a.listedAs !== a.ledger && ` (listed as ${a.listedAs})`}
                {a.percent !== null && ` · ${a.percent}%`}
                {a.amountPaise !== null && (
                  <>
                    {" "}
                    · <Money paise={a.amountPaise} />
                  </>
                )}
                {customRows(c, a.custom).map(([k, v]) => ` · ${k}: ${v}`)}
              </span>
            ))}
          </p>
        )}
      </Card>

      {lines.some((l) => l.gst || l.allocations?.length || lineCustom) && (
        <Card className="mt-4">
          <h2 className="mb-2 font-bold text-ink-strong" style={{ fontSize: 15 }}>
            Allocations, GST and HSN/SAC
          </h2>
          <div className="overflow-x-auto">
            <table aria-label="Allocations, GST and HSN/SAC" className="w-full text-[12.5px]" style={{ minWidth: 900 }}>
              <thead>
                <tr className="text-left text-ink-subtle">
                  <th className="px-2 py-1 font-semibold">#</th>
                  <th className="px-2 py-1 font-semibold">Item allocations</th>
                  <th className="px-2 py-1 font-semibold">GST</th>
                  <th className="px-2 py-1 font-semibold">HSN/SAC</th>
                  <th className="px-2 py-1 font-semibold">Discount / MRP</th>
                  {lineCustom && <th className="px-2 py-1 font-semibold">Other fields</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-hairline align-top">
                    <td className="px-2 py-1 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1">
                      {(l.allocations ?? []).map((a, j) => (
                        <span key={j} className="block">
                          Due {fmtDay(a.dueDate)} · {a.quantity} {a.ratePer} × <Money paise={a.ratePaise} /> = <Money paise={a.amountPaise} />
                          {a.trackingNo && ` · Tracking ${a.trackingNo}`}
                          {a.orderNo && ` · Order ${a.orderNo}`}
                          {a.costTracking && ` · Cost tracking ${a.costTracking}`}
                          {a.discPct !== null && a.discPct !== undefined && ` · Disc% ${a.discPct}`}
                          {a.discountPaise !== null && a.discountPaise !== undefined && (
                            <>
                              {" "}
                              · Discount <Money paise={a.discountPaise} />
                            </>
                          )}
                          {customRows(c, a.custom).map(([k, v]) => ` · ${k}: ${v}`)}
                        </span>
                      ))}
                    </td>
                    <td className="px-2 py-1">
                      {l.gst ? (
                        <>
                          <span className="block">{l.gst.rateDetails}</span>
                          {[l.gst.igstRate !== null && `IGST ${pct(l.gst.igstRate)}`, l.gst.cgstRate !== null && `CGST ${pct(l.gst.cgstRate)}`, l.gst.sgstRate !== null && `SGST/UTGST ${pct(l.gst.sgstRate)}`].filter(Boolean).join(" · ")}
                          {/* Each one on its own: any of them may be the only one given. */}
                          {l.gst.taxability && <span className="block text-ink-subtle">Taxability: {l.gst.taxability}</span>}
                          {l.gst.nature && <span className="block text-ink-subtle">Nature of transaction: {l.gst.nature}</span>}
                          {l.gst.classification && <span className="block text-ink-subtle">GST Classification: {l.gst.classification}</span>}
                          {l.gst.source && <span className="block text-ink-subtle">Source of details: {l.gst.source}</span>}
                          {l.gst.sourceType && <span className="block text-ink-subtle">Source type of master: {l.gst.sourceType}</span>}
                          <span className="block text-ink-subtle">
                            Taxable <Money paise={l.gst.taxablePaise} /> · Reverse charge {yes(l.gst.reverseCharge)} · ITC {yes(l.gst.itcEligible)}
                          </span>
                        </>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {l.hsn ? (
                        <>
                          <span className="block">{l.hsn.details}</span>
                          {[l.hsn.code, l.hsn.description, l.hsn.classification, l.hsn.source, l.hsn.sourceType].filter(Boolean).join(" · ")}
                        </>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {l.discPct === null && l.discountPaise === null && l.mrpPaise === null ? (
                        <Dash />
                      ) : (
                        <>
                          {l.discPct !== null && l.discPct !== undefined && <span className="block">Disc% {l.discPct}</span>}
                          {l.discountPaise !== null && l.discountPaise !== undefined && (
                            <span className="block">
                              Discount <Money paise={l.discountPaise} />
                            </span>
                          )}
                          {l.mrpPaise !== null && l.mrpPaise !== undefined && (
                            <span className="block">
                              MRP <Money paise={l.mrpPaise} />
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    {lineCustom && <td className="px-2 py-1">{inline(customRows(c, l.custom))}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
