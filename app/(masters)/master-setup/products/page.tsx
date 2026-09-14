import { requireAdmin } from "@/lib/auth/current";
import { listCategories, listProducts, listSkus } from "@/lib/queries/master-data";
import { ProductMasterTabs } from "@/components/masters/product-master-tabs";

export const dynamic = "force-dynamic";

/**
 * Product Master, inside Admin & Master Setup.
 *
 * Renders the SAME screen as /masters/products rather than a second design of
 * the same tables: two screens over one catalogue that looked and behaved
 * differently was the actual problem — whichever one you happened to open
 * decided what you could do. One component now serves both routes, so they
 * cannot drift again.
 *
 * The page keeps its own `requireAdmin()`: the Master Setup layout guards this
 * area, and the guard has to hold on this route in its own right.
 */
export default async function ProductMastersPage() {
  await requireAdmin();
  const [products, categories, skus] = await Promise.all([
    listProducts(),
    listCategories(),
    listSkus(),
  ]);
  return <ProductMasterTabs products={products} categories={categories} skus={skus} />;
}
