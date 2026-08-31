import { listClientBankMaster } from "@/lib/queries/client-kyc";
import { withDbRetry } from "@/lib/db/retry";
import { ClientBankMaster } from "@/components/forms/client-bank-master";

/**
 * Client Bank Master — every bank account across all clients. Reads the same
 * `customer_bank_accounts` rows Create New Client KYC writes.
 */
export default async function ClientBankMasterPage() {
  const rows = await withDbRetry("client banks", listClientBankMaster);
  return <ClientBankMaster rows={rows} />;
}
