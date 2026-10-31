import { requireAdmin } from "@/lib/auth/current";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { listClientMasterRows } from "@/lib/queries/client-kyc";
import { listClientBulkOptions } from "@/lib/queries/client-bulk-options";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { allWithDbRetry } from "@/lib/db/retry";
import { ClientMasterTable } from "@/components/forms/client-master-table";

export const dynamic = "force-dynamic";

/**
 * Customer Master, inside Forms — the Client Master's screen over the same
 * `customer_masters` register, moved here from Admin & Master Setup (that URL
 * redirects here). One component, one query, one edit path: nothing is
 * duplicated, and a customer Tally Data Import adds shows up on the next load.
 *
 * The route keeps the gate it had: the Forms module (checked by the layout and
 * again here) and admin. The Client Master beside it in the rail is the same
 * table for every Forms user.
 */
export default async function CustomerMasterPage() {
  await requireModuleAccess("forms");
  await requireAdmin();
  const [clients, salesPeople, bulk] = await allWithDbRetry([
    ["customer master", listClientMasterRows],
    ["sales people", listEmployeeOptions],
    ["bulk import options", listClientBulkOptions],
  ] as const);

  return <ClientMasterTable clients={clients} salesPeople={salesPeople} bulkOptions={bulk.options} title="Customer Master" csvName="customer-master" />;
}
