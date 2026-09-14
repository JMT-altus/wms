import { listClientAddressBook, listKycDropdownOptions } from "@/lib/queries/client-kyc";
import { allWithDbRetry } from "@/lib/db/retry";
import { ClientAddressBook } from "@/components/forms/client-address-book";

/**
 * Client Address Book — every address across all clients. Reads the same
 * `customer_addresses` rows Create New Client KYC writes; contact people now
 * live in Client Contact Master rather than here.
 *
 * The dropdown lists come along for the edit dialog's State and Country
 * pickers — the same admin-managed lists the KYC form's address blocks offer,
 * so an address corrected here can't carry a state the form would not.
 */
export default async function ClientAddressBookPage() {
  const [rows, dropdowns] = await allWithDbRetry([
    ["client addresses", listClientAddressBook],
    ["kyc dropdowns", listKycDropdownOptions],
  ] as const);

  return <ClientAddressBook rows={rows} states={dropdowns.state} countries={dropdowns.country} />;
}
