import { requireAdmin } from "@/lib/auth/current";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { getCapability } from "@/lib/auth/capability";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { TallyImportShell } from "@/components/admin/master/tally-import-shell";
import { listHistory } from "@/lib/queries/tally-import";

export const dynamic = "force-dynamic";

/**
 * Tally Data Import — the one place Tally files are imported, now a section of
 * the Forms module (it used to be under Admin & Master Setup; that URL
 * redirects here). Opening it needs the Forms module and admin, as before;
 * validating and importing need the sensitive `tally.import` permission,
 * checked again on every server action. A Forms grant alone imports nothing.
 *
 * What an import writes is read by the sibling Forms sections (Customer and
 * Vendor Master, the seven document ledgers, Outstanding Balances); each batch
 * in the history opens its own page listing every row it recorded.
 */
export default async function TallyImportPage() {
  await requireModuleAccess("forms");
  await requireAdmin();
  const [proof, history] = await Promise.all([getCapability("tally.import"), listHistory()]);

  return (
    <div>
      <MasterPageHead
        eyebrow="Forms · Tally"
        title="Tally Data Import"
        lede="Bring Tally masters, vouchers and outstanding balances into the WMS from Excel or CSV exports. Imported records appear in the matching Forms sections."
      />
      <TallyImportShell canImport={!!proof} storageReady={history.storageReady} history={history.rows} />
    </div>
  );
}
