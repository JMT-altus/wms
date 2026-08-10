import { ProductMasterManager } from "@/components/masters/product-master-manager";
import { listProducts } from "@/lib/queries/master-data";

export const dynamic = "force-dynamic";

/**
 * No page header component: the reference layout puts the title inline with
 * search, sort and the actions, so the table owns it (`title` prop).
 */
export default async function ProductMasterPage() {
  const products = await listProducts();
  return <ProductMasterManager products={products} />;
}
