"use client";
import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  FLANGE_TYPES,
  FLANGE_TYPE_LABELS,
  type FlangeType,
} from "@/db/enums";
import type { CategoryRow, ProductRow, SkuRow } from "@/lib/queries/master-data";
import {
  deleteCategory,
  deleteProduct,
  deleteSku,
  saveCategory,
  saveProduct,
  saveSku,
} from "@/app/(masters)/master-setup/actions";
import { DataTable, Dash, Pill, type Column } from "./data-table";
import {
  CancelButton,
  Drawer,
  Field,
  RowBtn,
  SaveButton,
  SelectInput,
  TextArea,
  TextInput,
  Toggle,
} from "./drawer";

type Tab = "categories" | "products" | "skus";

/** Depth-prefixed labels so the parent picker reads as a tree in a flat select. */
function indentedCategories(categories: CategoryRow[]) {
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const c of categories) {
    const k = c.parentId ?? null;
    byParent.set(k, [...(byParent.get(k) ?? []), c]);
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    if (depth > 10) return;
    for (const c of byParent.get(parent) ?? []) {
      out.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}` });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function ProductsManager({
  categories,
  products,
  skus,
}: {
  categories: CategoryRow[];
  products: ProductRow[];
  skus: SkuRow[];
}) {
  const [tab, setTab] = React.useState<Tab>("categories");
  const catOptions = React.useMemo(() => indentedCategories(categories), [categories]);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {(
          [
            ["categories", `Categories · ${categories.length}`],
            ["products", `Products · ${products.length}`],
            ["skus", `SKUs · ${skus.length}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
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

      {tab === "categories" && (
        <CategoriesTab categories={categories} catOptions={catOptions} />
      )}
      {tab === "products" && <ProductsTab products={products} catOptions={catOptions} />}
      {tab === "skus" && <SkusTab skus={skus} products={products} />}
    </div>
  );
}

/* ── Categories ──────────────────────────────────────────────────────────── */

function CategoriesTab({
  categories,
  catOptions,
}: {
  categories: CategoryRow[];
  catOptions: { id: string; label: string }[];
}) {
  const [editing, setEditing] = React.useState<CategoryRow | null | "new">(null);
  const [pending, start] = React.useTransition();

  const columns: Column<CategoryRow>[] = [
    { key: "name", header: "Category", render: (r) => <strong className="text-ink-strong">{r.name}</strong> },
    { key: "code", header: "Code" },
    { key: "parentName", header: "Parent", render: (r) => r.parentName ?? <Dash /> },
    { key: "productCount", header: "Products" },
    {
      key: "isActive",
      header: "Status",
      render: (r) => <Pill tone={r.isActive ? "green" : "slate"}>{r.isActive ? "Active" : "Inactive"}</Pill>,
      value: (r) => (r.isActive ? "Active" : "Inactive"),
    },
  ];

  return (
    <>
      <DataTable
        rows={categories}
        columns={columns}
        csvName="product-categories"
        searchPlaceholder="Search categories…"
        onNew={() => setEditing("new")}
        newLabel="New Category"
        emptyTitle="No categories yet."
        emptySub="Start with a top-level category such as Three-Phase Motor, then nest HP ratings under it."
        filters={[
          {
            key: "status",
            label: "All statuses",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ],
            matches: (r, v) => (v === "active" ? r.isActive : !r.isActive),
          },
        ]}
        actions={(r) => (
          <>
            <RowBtn title="Edit" onClick={() => setEditing(r)}>
              <Pencil size={14} strokeWidth={2.3} />
            </RowBtn>
            <RowBtn
              title="Delete"
              danger
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete "${r.name}"? Products in it are kept but lose their category.`)) return;
                start(async () => {
                  const res = await deleteCategory(r.id);
                  res.ok ? toast.success("Category deleted") : toast.error(res.error);
                });
              }}
            >
              <Trash2 size={14} strokeWidth={2.3} />
            </RowBtn>
          </>
        )}
      />
      {editing && (
        <CategoryForm
          row={editing === "new" ? null : editing}
          catOptions={catOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CategoryForm({
  row,
  catOptions,
  onClose,
}: {
  row: CategoryRow | null;
  catOptions: { id: string; label: string }[];
  onClose: () => void;
}) {
  const [name, setName] = React.useState(row?.name ?? "");
  const [code, setCode] = React.useState(row?.code ?? "");
  const [parentId, setParentId] = React.useState(row?.parentId ?? "");
  const [description, setDescription] = React.useState(row?.description ?? "");
  const [sortOrder, setSortOrder] = React.useState(row?.sortOrder ?? 100);
  const [isActive, setIsActive] = React.useState(row?.isActive ?? true);
  const [pending, start] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveCategory(row?.id ?? null, {
        name,
        code,
        parentId,
        description,
        sortOrder,
        isActive,
      });
      if (res.ok) {
        toast.success(row ? "Category updated" : "Category created");
        onClose();
      } else toast.error(res.error);
    });
  }

  return (
    <Drawer
      open
      title={row ? "Edit category" : "New category"}
      subtitle="Categories nest — put HP ratings under a motor type."
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} />
        </>
      }
    >
      <form id="cat-form" onSubmit={submit} className="grid gap-4">
        <Field label="Name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Three-Phase Motor" />
        </Field>
        <Field label="Code" hint="Optional short code. Must be unique.">
          <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. TPM" />
        </Field>
        <Field label="Parent category" hint="Leave blank for a top-level category.">
          <SelectInput value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— none (top level) —</option>
            {catOptions
              .filter((c) => c.id !== row?.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </SelectInput>
        </Field>
        <Field label="Description">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Sort order">
          <TextInput
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </Field>
        <Toggle checked={isActive} onChange={setIsActive} label="Active — shows in pickers" />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

/* ── Products ────────────────────────────────────────────────────────────── */

function ProductsTab({
  products,
  catOptions,
}: {
  products: ProductRow[];
  catOptions: { id: string; label: string }[];
}) {
  const [editing, setEditing] = React.useState<ProductRow | null | "new">(null);
  const [pending, start] = React.useTransition();

  const columns: Column<ProductRow>[] = [
    { key: "name", header: "Product", render: (r) => <strong className="text-ink-strong">{r.name}</strong> },
    { key: "code", header: "Code" },
    { key: "categoryName", header: "Category", render: (r) => r.categoryName ?? <Dash /> },
    { key: "brand", header: "Brand" },
    { key: "hp", header: "HP" },
    { key: "powerRating", header: "Power" },
    {
      key: "flangeType",
      header: "Flange",
      render: (r) => (r.flangeType ? <Pill tone="blue">{FLANGE_TYPE_LABELS[r.flangeType]}</Pill> : <Dash />),
      value: (r) => (r.flangeType ? FLANGE_TYPE_LABELS[r.flangeType] : ""),
    },
    { key: "kvh", header: "KVH" },
    { key: "skuCount", header: "SKUs" },
  ];

  return (
    <>
      <DataTable
        rows={products}
        columns={columns}
        csvName="products"
        searchPlaceholder="Search products…"
        onNew={() => setEditing("new")}
        newLabel="New Product"
        emptyTitle="No products yet."
        emptySub="Create a category first, then add products under it."
        filters={[
          {
            key: "category",
            label: "All categories",
            options: catOptions.map((c) => ({ value: c.id, label: c.label.replace(/— /g, "") })),
            matches: (r, v) => r.categoryId === v,
          },
          {
            key: "flange",
            label: "All flange types",
            options: FLANGE_TYPES.map((f) => ({ value: f, label: FLANGE_TYPE_LABELS[f] })),
            matches: (r, v) => r.flangeType === v,
          },
        ]}
        actions={(r) => (
          <>
            <RowBtn title="Edit" onClick={() => setEditing(r)}>
              <Pencil size={14} strokeWidth={2.3} />
            </RowBtn>
            <RowBtn
              title="Delete"
              danger
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete "${r.name}" and its ${r.skuCount} SKU(s)?`)) return;
                start(async () => {
                  const res = await deleteProduct(r.id);
                  res.ok ? toast.success("Product deleted") : toast.error(res.error);
                });
              }}
            >
              <Trash2 size={14} strokeWidth={2.3} />
            </RowBtn>
          </>
        )}
      />
      {editing && (
        <ProductForm
          row={editing === "new" ? null : editing}
          catOptions={catOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ProductForm({
  row,
  catOptions,
  onClose,
}: {
  row: ProductRow | null;
  catOptions: { id: string; label: string }[];
  onClose: () => void;
}) {
  const [f, setF] = React.useState({
    name: row?.name ?? "",
    code: row?.code ?? "",
    categoryId: row?.categoryId ?? "",
    brand: row?.brand ?? "",
    hp: row?.hp ?? "",
    powerRating: row?.powerRating ?? "",
    flangeType: (row?.flangeType ?? "") as FlangeType | "",
    kvh: row?.kvh ?? "",
    tallyName: row?.tallyName ?? "",
    description: "",
    isActive: row?.isActive ?? true,
  });
  const [pending, start] = React.useTransition();
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveProduct(row?.id ?? null, {
        ...f,
        flangeType: f.flangeType === "" ? null : f.flangeType,
      });
      if (res.ok) {
        toast.success(row ? "Product updated" : "Product created");
        onClose();
      } else toast.error(res.error);
    });
  }

  return (
    <Drawer
      open
      title={row ? "Edit product" : "New product"}
      subtitle="Attributes are all optional — a pump has no flange."
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} />
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Name" required>
          <TextInput value={f.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <TextInput value={f.code} onChange={(e) => set("code", e.target.value)} />
          </Field>
          <Field label="Brand">
            <TextInput value={f.brand} onChange={(e) => set("brand", e.target.value)} />
          </Field>
        </div>
        <Field label="Category">
          <SelectInput value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">— unassigned —</option>
            {catOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HP">
            <TextInput type="number" step="0.01" value={f.hp} onChange={(e) => set("hp", e.target.value)} />
          </Field>
          <Field label="Power rating">
            <TextInput value={f.powerRating} onChange={(e) => set("powerRating", e.target.value)} placeholder="e.g. 3.7 kW" />
          </Field>
          <Field label="Flange type">
            <SelectInput value={f.flangeType} onChange={(e) => set("flangeType", e.target.value)}>
              <option value="">— not recorded —</option>
              {FLANGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FLANGE_TYPE_LABELS[t]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="KVH">
            <TextInput value={f.kvh} onChange={(e) => set("kvh", e.target.value)} />
          </Field>
        </div>
        <Field label="Tally name" hint="Exact product name as it appears in a Tally export.">
          <TextInput value={f.tallyName} onChange={(e) => set("tallyName", e.target.value)} />
        </Field>
        <Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Active" />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

/* ── SKUs ────────────────────────────────────────────────────────────────── */

function SkusTab({ skus, products }: { skus: SkuRow[]; products: ProductRow[] }) {
  const [editing, setEditing] = React.useState<SkuRow | null | "new">(null);
  const [pending, start] = React.useTransition();

  const columns: Column<SkuRow>[] = [
    { key: "skuCode", header: "SKU / Item code", render: (r) => <strong className="text-ink-strong">{r.skuCode}</strong> },
    { key: "productName", header: "Product", render: (r) => r.productName ?? <Dash /> },
    { key: "categoryName", header: "Category", render: (r) => r.categoryName ?? <Dash /> },
    { key: "variantLabel", header: "Variant" },
    { key: "uom", header: "UOM" },
    { key: "listRate", header: "List rate" },
    { key: "tallyItemName", header: "Tally item" },
  ];

  return (
    <>
      <DataTable
        rows={skus}
        columns={columns}
        csvName="skus"
        searchPlaceholder="Search SKUs…"
        onNew={() => setEditing("new")}
        newLabel="New SKU"
        emptyTitle="No SKUs yet."
        emptySub="A SKU belongs to a product — create the product first."
        filters={[
          {
            key: "product",
            label: "All products",
            options: products.map((p) => ({ value: p.id, label: p.name })),
            matches: (r, v) => r.productId === v,
          },
        ]}
        actions={(r) => (
          <>
            <RowBtn title="Edit" onClick={() => setEditing(r)}>
              <Pencil size={14} strokeWidth={2.3} />
            </RowBtn>
            <RowBtn
              title="Delete"
              danger
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete SKU "${r.skuCode}"?`)) return;
                start(async () => {
                  const res = await deleteSku(r.id);
                  res.ok ? toast.success("SKU deleted") : toast.error(res.error);
                });
              }}
            >
              <Trash2 size={14} strokeWidth={2.3} />
            </RowBtn>
          </>
        )}
      />
      {editing && (
        <SkuForm row={editing === "new" ? null : editing} products={products} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function SkuForm({
  row,
  products,
  onClose,
}: {
  row: SkuRow | null;
  products: ProductRow[];
  onClose: () => void;
}) {
  const [f, setF] = React.useState({
    productId: row?.productId ?? "",
    skuCode: row?.skuCode ?? "",
    variantLabel: row?.variantLabel ?? "",
    uom: row?.uom ?? "Nos",
    listRate: row?.listRate ?? "",
    tallyItemName: row?.tallyItemName ?? "",
    isActive: row?.isActive ?? true,
  });
  const [pending, start] = React.useTransition();
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveSku(row?.id ?? null, f);
      if (res.ok) {
        toast.success(row ? "SKU updated" : "SKU created");
        onClose();
      } else toast.error(res.error);
    });
  }

  return (
    <Drawer
      open
      title={row ? "Edit SKU" : "New SKU"}
      subtitle="SKU codes are unique across the catalogue, case-insensitively."
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} />
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Product" required>
          <SelectInput value={f.productId} onChange={(e) => set("productId", e.target.value)} required>
            <option value="">— pick a product —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="SKU / Item code" required>
          <TextInput value={f.skuCode} onChange={(e) => set("skuCode", e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Variant label">
            <TextInput value={f.variantLabel} onChange={(e) => set("variantLabel", e.target.value)} />
          </Field>
          <Field label="UOM">
            <TextInput value={f.uom} onChange={(e) => set("uom", e.target.value)} />
          </Field>
          <Field label="List rate">
            <TextInput type="number" step="0.01" value={f.listRate} onChange={(e) => set("listRate", e.target.value)} />
          </Field>
          <Field label="Tally item name">
            <TextInput value={f.tallyItemName} onChange={(e) => set("tallyItemName", e.target.value)} />
          </Field>
        </div>
        <Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Active" />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
