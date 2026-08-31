import { listClientMasterRows } from "@/lib/queries/client-kyc";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { allWithDbRetry } from "@/lib/db/retry";
import { ClientMasterTable } from "@/components/forms/client-master-table";

/**
 * Client Master — the list of everything Create New Client KYC has onboarded.
 * Same `customer_masters` rows, read through one query; no separate client
 * store and no second creation path (New client routes back to the KYC form).
 */
export default async function ClientMasterPage() {
  // Sales people feed the edit dialog's Co-ordinator picker — Edit now opens
  // here rather than sending the user to /masters/customers.
  const [clients, salesPeople] = await allWithDbRetry([
    ["client master", listClientMasterRows],
    ["sales people", listEmployeeOptions],
  ] as const);
  return <ClientMasterTable clients={clients} salesPeople={salesPeople} />;
}
