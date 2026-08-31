import {
  listActiveDepartmentOptions,
  listActiveDesignationOptions,
  listClientContactMaster,
} from "@/lib/queries/client-kyc";
import { allWithDbRetry } from "@/lib/db/retry";
import { ClientContactMaster } from "@/components/forms/client-contact-master";

/**
 * Client Contact Master — every contact person across all clients. Reads the
 * same `customer_contacts` rows Create New Client KYC writes; no separate
 * contact store.
 *
 * The two roster lists come along for the edit dialog's Designation and
 * Department pickers — the same lists the KYC form offers, so an edit here
 * cannot invent a designation the form would not.
 */
export default async function ClientContactMasterPage() {
  const [rows, designations, departments] = await allWithDbRetry([
    ["client contacts", listClientContactMaster],
    ["designations", listActiveDesignationOptions],
    ["departments", listActiveDepartmentOptions],
  ] as const);

  return (
    <ClientContactMaster rows={rows} designations={designations} departments={departments} />
  );
}
