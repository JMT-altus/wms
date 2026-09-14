import { requireAdmin } from "@/lib/auth/current";
import { listClientMasterRows } from "@/lib/queries/client-kyc";
import { listClientBulkOptions } from "@/lib/queries/client-bulk-options";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { allWithDbRetry } from "@/lib/db/retry";
import { ClientMasterTable } from "@/components/forms/client-master-table";

export const dynamic = "force-dynamic";

/**
 * Customer Master, inside Admin & Master Setup — the Client Master's screen,
 * over the same register.
 *
 * Both routes called "Customer Master" (this one and /masters/customers) now
 * render the one table, for the reason given on that page: these were three
 * screens over a single `customer_masters` row, and which one you opened
 * decided what you could see and edit. Admin-only is the gate on the route,
 * not a different, thinner table.
 */
export default async function CustomerMastersPage() {
  await requireAdmin();
  const [clients, salesPeople, bulk] = await allWithDbRetry([
    ["customer master", listClientMasterRows],
    ["sales people", listEmployeeOptions],
    ["bulk import options", listClientBulkOptions],
  ] as const);

  return (
    <ClientMasterTable
      clients={clients}
      salesPeople={salesPeople}
      bulkOptions={bulk.options}
      title="Customer Master"
      csvName="customer-master"
    />
  );
}
