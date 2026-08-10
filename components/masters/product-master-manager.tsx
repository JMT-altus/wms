"use client";
import * as React from "react";
import { toast } from "sonner";
import type { ProductRow } from "@/lib/queries/master-data";
import {
  deleteMasterProduct,
  saveMasterProduct,
} from "@/app/(masters-module)/masters/actions";
import {
  DataTable,
  Dash,
  type Column,
  type SortDef,
} from "@/components/admin/master/data-table";
import {
  CancelButton,
  Field,
  SaveButton,
  TextArea,
  TextInput,
  Toggle,
} from "@/components/admin/master/drawer";
import { CodeCell, RowMenu, StatusCell } from "./row-menu";
import { MastersDialog } from "./masters-dialog";
import { MASTERS_GRADIENT } from "./theme";
import { BulkUpload } from "./bulk-upload";

const ACCENT = MASTERS_GRADIENT;
/** The Save button lives in the dialog footer, outside the form — see SaveButton. */
const FORM_ID = "masters-product-form";

export function ProductMasterManager({ products }: { products: ProductRow[] }) {
  const [editing, setEditing] = React.useState<ProductRow | null | "new">(null);
  const [pending, start] = React.useTransition();

  const columns: Column<ProductRow>[] = [
    {
      key: "code",
      header: "Code",
      render: (r) => (r.code ? <CodeCell>{r.code}</CodeCell> : <Dash />),
      width: 200,
    },
    {
      key: "name",
      header: "Name",
      render: (r) => <strong className="text-ink-strong">{r.name}</strong>,
    },
    {
      key: "specification",
      header: "Specification",
      // Specs run long. Clamp the cell and keep the full string in the title so
      // the column can't push the table into a horizontal scroll on its own.
      render: (r) =>
        r.specification ? (
          <span className="block truncate" style={{ maxWidth: 420 }} title={r.specification}>
            {r.specification}
          </span>
        ) : (
          <Dash />
        ),
      value: (r) => r.specification ?? "",
    },
    {
      key: "isActive",
      header: "Status",
      render: (r) => <StatusCell active={r.isActive} />,
      value: (r) => (r.isActive ? "Active" : "Inactive"),
      width: 110,
    },
  ];

  const sorts: SortDef<ProductRow>[] = [
    { value: "newest", label: "Newest First", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
    { value: "oldest", label: "Oldest First", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
    { value: "name", label: "Name A–Z", compare: (a, b) => a.name.localeCompare(b.name) },
    { value: "name_desc", label: "Name Z–A", compare: (a, b) => b.name.localeCompare(a.name) },
    {
      value: "code",
      label: "Code A–Z",
      // Codes are optional; the unlabelled ones sort to the bottom rather than
      // to the top, where they'd bury the rows you can actually identify.
      compare: (a, b) => (a.code ?? "￿").localeCompare(b.code ?? "￿"),
    },
  ];

  function remove(row: ProductRow) {
    if (!confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    start(async () => {
      const res = await deleteMasterProduct(row.id);
      if (res.ok) toast.success("Product deleted.");
      else toast.error(res.error);
    });
  }

  return (
    <>
      <DataTable
        rows={products}
        columns={columns}
        title="Product Master"
        sorts={sorts}
        tintHeader
        exportLabel="Export to Excel"
        csvName="product-master"
        searchPlaceholder="Search products"
        onNew={() => setEditing("new")}
        newLabel="New Product"
        accent={ACCENT}
        extraActions={<BulkUpload target="products" label="products" />}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ],
            matches: (r, v) => (v === "active" ? r.isActive : !r.isActive),
          },
          {
            key: "spec",
            label: "Spec",
            options: [
              { value: "yes", label: "Recorded" },
              { value: "no", label: "Missing" },
            ],
            matches: (r, v) => (v === "yes" ? !!r.specification : !r.specification),
          },
        ]}
        emptyTitle="No products yet."
        emptySub="Add one with New Product, or bring your existing list in with Bulk Upload."
        actions={(row) => (
          <RowMenu
            label={row.name}
            disabled={pending}
            onEdit={() => setEditing(row)}
            onDelete={() => remove(row)}
          />
        )}
      />

      {editing !== null && (
        <ProductForm
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ProductForm({ row, onClose }: { row: ProductRow | null; onClose: () => void }) {
  const [name, setName] = React.useState(row?.name ?? "");
  const [code, setCode] = React.useState(row?.code ?? "");
  const [specification, setSpecification] = React.useState(row?.specification ?? "");
  const [isActive, setIsActive] = React.useState(row?.isActive ?? true);
  const [pending, start] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveMasterProduct(row?.id ?? null, {
        name,
        code,
        specification,
        isActive,
      });
      if (res.ok) {
        toast.success(row ? "Product updated." : "Product added.");
        onClose();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <MastersDialog
      open
      width={620}
      title={row ? "Edit product" : "New product"}
      subtitle={
        row
          ? "Changes apply everywhere this product is quoted."
          : "Name is required. Code and specification can be filled in later."
      }
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} accent={ACCENT} form={FORM_ID}>
            {row ? "Save changes" : "Add product"}
          </SaveButton>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-5">
        <Field label="Name" required>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tungsten Carbide Flat"
            autoFocus
            required
            maxLength={200}
          />
        </Field>

        <Field label="Code" hint="Your internal item code or part number.">
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. S-10019-F-CIW06"
            maxLength={60}
          />
        </Field>

        <Field
          label="Specification"
          hint="The technical description quoted from — grade, tolerance, condition, dimensions."
        >
          <TextArea
            value={specification}
            onChange={(e) => setSpecification(e.target.value)}
            placeholder="e.g. Flat — Reg · CIW06 · VSI · Thickness Clean · L 102 × W 36 × T 9.20 mm"
            rows={4}
            maxLength={2000}
          />
        </Field>

        <Toggle checked={isActive} onChange={setIsActive} label="Active" />
      </form>
    </MastersDialog>
  );
}
