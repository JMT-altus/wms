import { listClientMasterRows, listKycDropdownOptions } from "@/lib/queries/client-kyc";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { creditLimitTotals, listCreditLimitChanges } from "@/lib/masters/credit-limit";
import { allWithDbRetry } from "@/lib/db/retry";
import { CreditLimitChanges } from "@/components/forms/credit-limit-changes";

/**
 * Credit Limit — the history of every change, and the sheet that makes them.
 *
 * Its own section beside the Client Master. The two answer different
 * questions: the Client Master's Credit Limit column says what a client's
 * limit IS, and can only ever say that — the previous figure is overwritten
 * the moment someone edits it. This says what CHANGED, which way, by how much
 * and who did it, which is the question a review actually asks.
 *
 * Table is that record; Grid is where the limits get set. An edit in the grid
 * writes through the same action every other screen uses, which is what puts
 * the row into the history — the two halves are the same loop.
 *
 * The clients come from `listClientMasterRows`, the Client Master's own
 * query, so the grid edits exactly the register that screen shows.
 */
export const dynamic = "force-dynamic";

export default async function CreditLimitPage() {
  const [changes, totals, clients, salesPeople, dropdowns] = await allWithDbRetry([
    ["credit limit history", () => listCreditLimitChanges()],
    ["credit limit totals", creditLimitTotals],
    ["client master", listClientMasterRows],
    // Not shown as a picker — the grid rebuilds the whole client on save and
    // needs the roster to resolve the Sales Co-ordinator it isn't editing.
    ["sales people", listEmployeeOptions],
    ["kyc dropdowns", listKycDropdownOptions],
  ] as const);

  return (
    <CreditLimitChanges
      changes={changes}
      totals={totals}
      clients={clients}
      salesPeople={salesPeople}
      paymentTerms={dropdowns.kyc_payment_terms}
    />
  );
}
