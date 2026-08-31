import { CUSTOMER_CATEGORY_LIST_KEY } from "@/db/enums";
import { CustomerMasterManager } from "@/components/masters/customer-master-manager";
import { listCustomers, listLookupOptions } from "@/lib/queries/master-data";

export const dynamic = "force-dynamic";

/** Title lives inline in the table toolbar — see the products page note. */
export default async function CustomerMasterPage() {
  const [customers, categoryOptions] = await Promise.all([
    listCustomers(),
    listLookupOptions(CUSTOMER_CATEGORY_LIST_KEY),
  ]);

  return (
    <CustomerMasterManager
      customers={customers}
      categoryOptions={categoryOptions}
    />
  );
}
