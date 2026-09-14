import { listClientMasterRows } from "@/lib/queries/client-kyc";
import { listClientBulkOptions } from "@/lib/queries/client-bulk-options";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { allWithDbRetry } from "@/lib/db/retry";
import { ClientMasterTable } from "@/components/forms/client-master-table";

export const dynamic = "force-dynamic";

/**
 * Customer Master — the Client Master's screen, over the same register.
 *
 * These were two screens on one `customer_masters` table: the same rows, read
 * through a narrower query, shown in fewer columns, edited through a dialog
 * that covered a dozen fields. Every column, filter, inline editor and export
 * added to the Client Master had to be added here too, and never was — so
 * which screen you happened to open decided what you could see and do to a
 * customer.
 *
 * Now it IS that screen. One component, one column list, one set of filters,
 * one edit path. Only the heading differs, because that is what the rail calls
 * this route.
 *
 * The narrower form has not been deleted: /master-setup/customers still
 * renders `CustomerMasterManager`, which owns the fields this table does not
 * carry (Customer Category, purchase pattern, sensitivity) and is where an
 * admin sets them.
 */
export default async function CustomerMasterPage() {
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
