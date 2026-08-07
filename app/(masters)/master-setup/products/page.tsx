import { requireAdmin } from "@/lib/auth/current";
import { listCategories, listProducts, listSkus } from "@/lib/queries/master-data";
import { ProductsManager } from "@/components/admin/master/products-manager";
import { MasterPageHead } from "@/components/admin/master/page-head";

export const dynamic = "force-dynamic";

export default async function ProductMastersPage() {
  await requireAdmin();
  const [categories, products, skus] = await Promise.all([
    listCategories(),
    listProducts(),
    listSkus(),
  ]);

  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Product Masters"
        lede={
          <>
            The three-tier catalogue: Category → Product → SKU. {categories.length} categories ·{" "}
            {products.length} products · {skus.length} SKUs.
          </>
        }
      />
      <ProductsManager categories={categories} products={products} skus={skus} />
    </div>
  );
}
