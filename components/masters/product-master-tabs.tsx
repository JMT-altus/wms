"use client";

import * as React from "react";
import type { CategoryRow, ProductRow, SkuRow } from "@/lib/queries/master-data";
import { ProductMasterManager } from "./product-master-manager";
import {
  CategoriesTab,
  SkusTab,
  indentedCategories,
} from "@/components/admin/master/products-manager";

type Tab = "products" | "categories" | "skus";

/**
 * Product Master with the rest of the catalogue behind it.
 *
 * Products lead because that's what people come here for; Category and SKU are
 * the scaffolding underneath, edited far less often. They're tabs rather than
 * separate screens so the three tiers stay one destination — you add a
 * category and a product against it without navigating away.
 *
 * The Category and SKU tables are the ones the old Products Manager already
 * had, imported rather than rewritten: one implementation, whichever screen
 * you reach it from.
 */
export function ProductMasterTabs({
  products,
  categories,
  skus,
}: {
  products: ProductRow[];
  categories: CategoryRow[];
  skus: SkuRow[];
}) {
  const [tab, setTab] = React.useState<Tab>("products");
  const catOptions = React.useMemo(() => indentedCategories(categories), [categories]);

  const TABS: [Tab, string][] = [
    ["products", `Products · ${products.length}`],
    ["categories", `Categories · ${categories.length}`],
    ["skus", `SKUs · ${skus.length}`],
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-1.5" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="rounded-pill px-4 py-2.5 font-bold transition-colors"
            style={
              tab === id
                ? { fontSize: 14, background: "var(--color-ink-strong)", color: "#fff" }
                : {
                    fontSize: 14,
                    background: "var(--color-surface-card)",
                    color: "var(--color-ink-muted)",
                    border: "1px solid var(--color-hairline)",
                  }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "products" && <ProductMasterManager products={products} />}
      {tab === "categories" && (
        <CategoriesTab categories={categories} catOptions={catOptions} />
      )}
      {tab === "skus" && <SkusTab skus={skus} products={products} />}
    </div>
  );
}
