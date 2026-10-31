import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Banknote, Building2, ClipboardList, Contact, FileDiff, FileMinus, FilePlus2, FileUp, Receipt, Scale, ShoppingCart, Wallet, type LucideIcon } from "lucide-react";
import { requireFormsViewer } from "@/lib/auth/forms-access";
import { getCurrentEmployee } from "@/lib/auth/current";
import { formsOverviewCounts } from "@/lib/queries/tally-ledger";
import { DOCUMENT_SECTIONS, FORMS_ROUTES, TALLY_DOCUMENT_TYPES, outstandingHref } from "@/lib/tally/sections";
import { SectionHead, StoragePending } from "@/components/forms/tally/ui";

export const dynamic = "force-dynamic";

const ICONS: Record<string, LucideIcon> = { "sales-orders": ClipboardList, "sales-invoices": Receipt, "purchase-invoices": ShoppingCart, "credit-notes": FileMinus, "debit-notes": FileDiff, "customer-receipts": Wallet, "vendor-payments": Banknote };

/**
 * Forms overview — one tile per section, with the live count of what each
 * holds, so a person who has just imported a Tally file can see where the
 * records went. Counts come from the tables themselves; nothing is cached or
 * estimated. The module gate (Admin → Access) is the only requirement; the
 * admin-only tiles (Customer Master, Tally Data Import) are shown to admins.
 */
export default async function FormsOverviewPage() {
  const viewer = await requireFormsViewer();
  const [me, counts] = await Promise.all([getCurrentEmployee(), formsOverviewCounts(viewer)]);
  const isAdmin = me?.isAdmin === true;
  const n = (v: number) => v.toLocaleString("en-IN");

  const tiles: { href: Route; label: string; hint: string; icon: LucideIcon; count: string; group: string }[] = [
    { href: "/forms/client-kyc/new" as Route, label: "Create New Client KYC", hint: "Onboard a client end to end.", icon: FilePlus2, count: "", group: "Client KYC" },
    ...(isAdmin ? [{ href: FORMS_ROUTES.customerMaster, label: "Customer Master", hint: "Every customer, including those Tally Data Import added.", icon: Contact, count: `${n(counts.customers)} active`, group: "Masters" }] : []),
    { href: FORMS_ROUTES.vendorMaster, label: "Vendor Master", hint: "Vendors from Tally, with GSTIN and contact details.", icon: Building2, count: `${n(counts.vendors)} vendors`, group: "Masters" },
    ...(isAdmin ? [{ href: FORMS_ROUTES.tallyImport, label: "Tally Data Import", hint: "Upload, map, validate and import Tally exports.", icon: FileUp, count: `${n(counts.batches)} imports`, group: "Tally" }] : []),
    ...TALLY_DOCUMENT_TYPES.map((t) => ({ href: DOCUMENT_SECTIONS[t].href, label: DOCUMENT_SECTIONS[t].label, hint: DOCUMENT_SECTIONS[t].hint, icon: ICONS[t]!, count: `${n(counts.documents[t])} documents`, group: "Tally" })),
    { href: outstandingHref("receivables"), label: "Outstanding Balances", hint: "Receivables and payables, by snapshot.", icon: Scale, count: `${n(counts.receivables)} receivable · ${n(counts.payables)} payable lines`, group: "Tally" },
  ];
  const groups = [...new Set(tiles.map((t) => t.group))];

  return (
    <div>
      <SectionHead eyebrow="Forms" title="Forms" lede="Client KYC, the customer and vendor masters, and the Tally ledgers. Each tile shows how many records its section holds right now." />
      {!counts.storageReady && (
        <div className="mb-4">
          <StoragePending />
        </div>
      )}
      {groups.map((g) => (
        <section key={g} className="mb-6" aria-label={g}>
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">{g}</h2>
          <div className="grid grid-cols-3 max-lg:grid-cols-2 max-md:grid-cols-1 gap-3">
            {tiles
              .filter((t) => t.group === g)
              .map((t) => {
                const Icon = t.icon;
                return (
                  <Link key={t.href} href={t.href} className="group rounded-section bg-surface-card p-4 transition-transform hover:-translate-y-0.5" style={{ border: "1px solid var(--color-hairline)", boxShadow: "0 14px 32px -20px rgba(190, 18, 60, 0.18), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" }}>
                    <div className="flex items-start gap-3">
                      <span aria-hidden className="grid place-items-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: "#FDF2F6", color: "#B8325F" }}>
                        <Icon size={19} strokeWidth={2.2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-ink-strong" style={{ fontSize: 15.5 }}>
                          {t.label}
                        </p>
                        <p className="mt-0.5 text-ink-muted" style={{ fontSize: 13 }}>
                          {t.hint}
                        </p>
                        {t.count && (
                          <p className="mt-2 tabular-nums font-bold text-ink-strong" style={{ fontSize: 13.5 }}>
                            {t.count}
                          </p>
                        )}
                      </div>
                      <ArrowRight size={16} strokeWidth={2.4} className="shrink-0 mt-1 text-ink-subtle transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
