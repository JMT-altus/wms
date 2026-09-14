import { listClientBankMaster, listKycDropdownOptions } from "@/lib/queries/client-kyc";
import { allWithDbRetry } from "@/lib/db/retry";
import { ClientBankMaster } from "@/components/forms/client-bank-master";

/**
 * Client Bank Master — every bank account across all clients. Reads the same
 * `customer_bank_accounts` rows Create New Client KYC writes.
 *
 * The two dropdown lists come along for the edit dialog's Bank Name and
 * Account Type pickers — the same admin-managed lists the KYC form's Bank
 * Details block offers.
 */
export default async function ClientBankMasterPage() {
  const [rows, dropdowns] = await allWithDbRetry([
    ["client banks", listClientBankMaster],
    ["kyc dropdowns", listKycDropdownOptions],
  ] as const);

  return (
    <ClientBankMaster
      rows={rows}
      bankNames={dropdowns.bank_name}
      accountTypes={dropdowns.bank_account_type}
    />
  );
}
