import { CUSTOMER_CATEGORY_LIST_KEY } from "@/db/enums";
import { CustomerMasterManager } from "@/components/masters/customer-master-manager";
import { listCustomers, listLookupOptions } from "@/lib/queries/master-data";
import { listEmployeeOptions } from "@/lib/queries/employees";

export const dynamic = "force-dynamic";

/** Title lives inline in the table toolbar — see the products page note. */
export default async function CustomerMasterPage() {
  const [customers, salesReps, categoryOptions] = await Promise.all([
    listCustomers(),
    listEmployeeOptions(),
    listLookupOptions(CUSTOMER_CATEGORY_LIST_KEY),
  ]);

  return (
    <CustomerMasterManager
      customers={customers}
      salesReps={salesReps}
      categoryOptions={categoryOptions}
    />
  );
}
