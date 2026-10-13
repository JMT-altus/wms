import { requireAdmin } from "@/lib/auth/current";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { TallyImportShell } from "@/components/admin/master/tally-import-shell";

export const dynamic = "force-dynamic";

/**
 * Tally Data Import — layout only. No file is read or stored and there is no
 * database access beyond the admin gate; see TallyImportShell.
 */
export default async function TallyImportPage() {
  await requireAdmin();

  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Tally Data Import"
        lede="Bring Tally masters, vouchers and outstanding balances into the WMS from Excel or CSV exports."
      />
      <TallyImportShell />
    </div>
  );
}
