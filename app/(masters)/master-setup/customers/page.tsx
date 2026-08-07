import { requireAdmin } from "@/lib/auth/current";
import { listCustomers, listLookupOptions } from "@/lib/queries/master-data";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { CUSTOMER_CATEGORY_LIST_KEY } from "@/db/enums";
import { CustomersManager } from "@/components/admin/master/customers-manager";
import { MasterPageHead } from "@/components/admin/master/page-head";

export const dynamic = "force-dynamic";

export default async function CustomerMastersPage() {
  await requireAdmin();
  const [customers, salesReps, categoryOptions] = await Promise.all([
    listCustomers(),
    listEmployeeOptions(),
    listLookupOptions(CUSTOMER_CATEGORY_LIST_KEY),
  ]);

  const classified = customers.filter((c) => c.volumeClass).length;
  const categorised = customers.filter((c) => c.customerCategory).length;

  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Customer Masters"
        lede={
          <>
            Profiles, sales-rep ownership and behavioural classification. {customers.length}{" "}
            customers · {categorised} categorised · {classified} classified by volume.
          </>
        }
      />
      <CustomersManager
        customers={customers}
        salesReps={salesReps}
        categoryOptions={categoryOptions}
      />
    </div>
  );
}
