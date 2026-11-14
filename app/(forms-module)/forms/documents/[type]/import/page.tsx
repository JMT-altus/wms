import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/current";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { getCapability } from "@/lib/auth/capability";
import { listHistory, salesOrderDetailsReady, salesOrderLinkOptions } from "@/lib/queries/tally-import";
import { DOCUMENT_SECTIONS } from "@/lib/tally/sections";
import { loadSalesOrderCatalogue } from "@/lib/queries/sales-order-fields";
import { SectionHead } from "@/components/forms/tally/ui";
import { TallyImportShell } from "@/components/admin/master/tally-import-shell";

export const dynamic = "force-dynamic";

/**
 * Forms → Sales Orders → Import: Sales Orders from TallyPrime's Excel import
 * format. A screen of the Sales Orders section, not a module of its own — it
 * is the existing Tally import (same tables, same server actions, same
 * history) with the category fixed to Sales Orders.
 *
 * The gate is the Tally import's own: the Forms module and admin to open it,
 * and the sensitive `tally.import` permission to validate, match or import —
 * checked again on every server action. Without the permission the screen is
 * read-only and the master lists (used only for matching) are not sent.
 */
export default async function SalesOrderImportPage({ params }: { params: Promise<{ type: string }> }) {
  await requireModuleAccess("forms");
  await requireAdmin();
  const { type } = await params;
  // Only Sales Orders have this screen; every other ledger imports through Tally Data Import.
  if (type !== "sales-orders") notFound();
  const proof = await getCapability("tally.import");
  const [history, linkOptions, detailsReady, fields] = await Promise.all([
    listHistory(50, "sales-orders"),
    proof ? salesOrderLinkOptions() : Promise.resolve({ customers: [], products: [], ledgers: [] }),
    salesOrderDetailsReady(),
    // The field configuration of Admin & Master Setup → Sales Order Fields (TallyPrime's matrix as it is before 0128).
    loadSalesOrderCatalogue(),
  ]);
  const def = DOCUMENT_SECTIONS["sales-orders"];

  return (
    <div>
      <SectionHead
        eyebrow="Forms · Sales Orders"
        title="Import Sales Orders"
        lede="Upload Tally's Excel import format, or enter an order on the form. Every voucher becomes one order with all its product lines, ledgers, allocations, GST and party details, matched to the Customer Master and the Product Master. Nothing is saved until it has been validated and you have confirmed."
        back={{ href: def.href, label: def.label }}
      />
      {history.storageReady && !detailsReady && (
        <div role="status" className="mb-6 rounded-section px-5 py-4 text-ink-muted" style={{ fontSize: 14, background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
          <strong className="text-ink-strong">Database update 0127 needed.</strong> Orders can be checked and previewed, but importing stays off until the Sales Order details column is added, so none of an order&apos;s fields are dropped.
        </div>
      )}
      <TallyImportShell lockedCategory="sales-orders" canImport={!!proof} storageReady={history.storageReady} history={history.rows} linkOptions={linkOptions} importBlocked={history.storageReady && !detailsReady ? "Importing needs database update 0127 first." : undefined} soSettings={fields.settings} soConfigVersion={fields.catalogue.version} />
    </div>
  );
}
