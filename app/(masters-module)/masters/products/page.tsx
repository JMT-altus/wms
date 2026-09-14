import { listCategories, listProducts, listSkus } from "@/lib/queries/master-data";
import { ProductMasterTabs } from "@/components/masters/product-master-tabs";

export const dynamic = "force-dynamic";

/**
 * No page header component: the reference layout puts the title inline with
 * search, sort and the actions, so the table owns it (`title` prop).
 *
 * Products lead; Category and SKU sit behind tabs on the same screen — the
 * same component Admin & Master Setup renders, so the two never diverge.
 */
export default async function ProductMasterPage() {
  const [products, categories, skus] = await Promise.all([
    listProducts(),
    listCategories(),
    listSkus(),
  ]);
  return <ProductMasterTabs products={products} categories={categories} skus={skus} />;
}
