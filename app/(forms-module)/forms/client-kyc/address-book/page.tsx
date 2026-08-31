import { listClientAddressBook } from "@/lib/queries/client-kyc";
import { withDbRetry } from "@/lib/db/retry";
import { ClientAddressBook } from "@/components/forms/client-address-book";

/**
 * Client Address Book — every address across all clients. Reads the same
 * `customer_addresses` rows Create New Client KYC writes; contact people now
 * live in Client Contact Master rather than here.
 */
export default async function ClientAddressBookPage() {
  const rows = await withDbRetry("client addresses", listClientAddressBook);
  return <ClientAddressBook rows={rows} />;
}
