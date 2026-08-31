import { listKycDropdowns } from "@/lib/queries/client-kyc";
import { CustDropdownMaster } from "@/components/forms/cust-dropdown-master";

/**
 * Client Master DD — configuration for every editable Client KYC dropdown.
 * Reads the same registry and stores the KYC form reads, so there is one
 * source of truth rather than a parallel set of options.
 */
export default async function CustDropdownMasterPage() {
  const lists = await listKycDropdowns();
  return <CustDropdownMaster lists={lists} />;
}
