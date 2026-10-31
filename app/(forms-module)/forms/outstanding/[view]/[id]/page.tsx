import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireFormsViewer } from "@/lib/auth/forms-access";
import { getOutstandingLine } from "@/lib/queries/tally-ledger";
import { FORMS_ROUTES, OUTSTANDING_VIEWS, isOutstandingView, outstandingHref, vendorHref } from "@/lib/tally/sections";
import { BatchSource, KeyValues, Money, SectionHead, fmtDay, fmtWhen } from "@/components/forms/tally/ui";
import { financialYearOf } from "@/components/forms/tally/outstanding-list";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One outstanding line: the bill, the party links, the snapshot it belongs to and the import that recorded it. */
export default async function OutstandingLinePage({ params }: { params: Promise<{ view: string; id: string }> }) {
  const viewer = await requireFormsViewer();
  const { view, id } = await params;
  if (!isOutstandingView(view) || !UUID.test(id)) notFound();
  const def = OUTSTANDING_VIEWS[view];
  const found = await getOutstandingLine(viewer, def.direction, id);
  if (!found) notFound();
  const { line: l, party, batch, collectionCompany } = found;
  return (
    <div>
      <SectionHead eyebrow={`Forms · Tally ledgers · Outstanding · ${def.label}`} title={l.billRef ?? l.partyName} lede={`${l.partyName} · as of ${fmtDay(l.asOfDate)}`} back={{ href: outstandingHref(view), label: `Outstanding ${def.label}` }} />
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        <KeyValues
          title="Bill"
          items={[
            ["Side", l.direction === "receivable" ? "Receivable — Dr, owed to us" : "Payable — Cr, we owe"],
            ["Bill reference", l.billRef],
            ["Bill date", fmtDay(l.billDate)],
            ["Due date", fmtDay(l.dueDate)],
            ["Original amount", <Money key="o" paise={l.originalPaise} />],
            ["Outstanding amount", <Money key="p" paise={l.pendingPaise} strong />],
            ["Financial year", financialYearOf(l.billDate ?? l.asOfDate)],
            ["Snapshot as of", fmtDay(l.asOfDate)],
            ["Narration", l.narration],
            ["Recorded", fmtWhen(l.createdAt)],
          ]}
        />
        <div className="flex flex-col gap-4">
          <KeyValues
            title={def.party === "vendor" ? "Vendor" : "Customer"}
            items={[
              ["Name on statement", l.partyName],
              [
                "Linked to",
                party ? (
                  party.kind === "vendor" ? (
                    <Link href={vendorHref(party.id)} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">
                      {party.name} (Vendor Master)
                    </Link>
                  ) : (
                    <Link href={FORMS_ROUTES.customerMaster} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">
                      {party.name} (Customer Master)
                    </Link>
                  )
                ) : (
                  <span className="text-amber-700 font-semibold">Not linked — no matching {def.party} in the WMS masters when this was imported.</span>
                ),
              ],
              ...(l.direction === "receivable"
                ? ([["Collection Master company", collectionCompany ? <Link key="c" href={"/collection/master" as Route} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">{collectionCompany.name}</Link> : "Not matched by name"]] as const)
                : []),
            ]}
          />
          <BatchSource batch={batch} categoryLabel={`Outstanding Balances · ${def.label}`} />
          {batch && <p className="text-[12px] text-ink-subtle -mt-2 px-1">Source row {l.sourceRow} of the file.</p>}
        </div>
      </div>
    </div>
  );
}
