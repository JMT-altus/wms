"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ClientMasterRow } from "@/lib/queries/client-kyc";
import type { EmployeeOption } from "@/lib/queries/employees";
import {
  CLIENT_GRID_COLUMNS,
  optionsFor,
  splitMulti,
  type ClientBulkOptions,
} from "@/lib/forms/client-bulk-columns";
import {
  updateClientMasterRecord,
  updateClientProducts,
} from "@/app/(forms-module)/forms/client-kyc/actions";
import { MasterGrid, type GridCol } from "@/components/admin/master/master-grid";
import type { SaveResult } from "@/components/admin/master/inline-edit";
import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./kyc/tokens";

/**
 * Client Master — Grid View.
 *
 * The shared `MasterGrid` over this master's own columns. How the sheet
 * behaves — pinned columns, the two searches, save-as-you-go — lives there and
 * is the same on every master; what is here is which columns the Client Master
 * has and how a row of them is written back.
 *
 * The columns are `CLIENT_GRID_COLUMNS`, the same catalogue the Bulk Import
 * sheet and the .xlsx template read, so the sheet that creates clients and the
 * sheet that edits them cannot drift apart.
 *
 * Contacts, addresses and bank accounts are absent. Each writes a child table
 * `updateClientMasterRecord` does not touch, and each has a master of its own.
 */

export type ClientGridCells = Record<string, string>;
type Cells = ClientGridCells;

const yesNo = (v: boolean) => (v ? "Yes" : "No");

/**
 * Every field the grid shows, as the strings the cells work in.
 *
 * Exported because the Credit Limit section edits the same client row through
 * a narrower set of columns: it builds these cells, overrides the two it
 * shows, and sends the result through `clientGridPayload` below. Rebuilding
 * the mapping there would be a second way to write a client that could drift
 * from this one.
 */
export function clientGridCells(r: ClientMasterRow): Cells {
  return {
    code: r.code ?? "",
    name: r.name,
    gstin: r.gstin ?? "",
    reference: r.reference ?? "",
    salesRep: r.salesRepName ?? "",
    grade: r.grade ?? "",
    tags: r.tags.join(", "),
    customerTypes: r.customerTypes.join(", "),
    industryTypes: r.industryTypes.join(", "),
    products: r.products.join(", "),
    panNo: r.panNo ?? "",
    msmeUdyamNo: r.msmeUdyamNo ?? "",
    gstRegistrationType: r.gstRegistrationType ?? "",
    state: r.state ?? "",
    tinNumber: r.tinNumber ?? "",
    testCertificateNeeded: yesNo(r.testCertificateNeeded),
    website: r.website ?? "",
    tcsApplicable: yesNo(r.tcsApplicable),
    paymentTerms: r.paymentTerms ?? "",
    freightCharges: r.freightCharges ?? "",
    creditDays: r.creditDays === null ? "" : String(r.creditDays),
    creditLimit: r.creditLimit ?? "",
    transporter: r.transporter ?? "",
    quantityDeviation: r.quantityDeviation ?? "",
    otherReferences: r.otherReferences ?? "",
    notes: r.notes ?? "",
    exportClient: r.exportClient ?? "",
    iecNumber: r.iecNumber ?? "",
    currency: r.currency ?? "",
    country: r.country ?? "",
    focusedView: yesNo(r.focusedView),
    isActive: r.isActive ? "Active" : "Inactive",
  };
}

/**
 * The sheet row as `ClientMasterEditSchema` wants it.
 *
 * `city` is deliberately absent, not blank: the schema leaves the column alone
 * when the field is missing, which is what keeps a grid edit from wiping the
 * billing city the Address Book owns.
 */
export function clientGridPayload(c: Cells, salesIdByName: Map<string, string>) {
  // `Cells` is an open record, so every read is `string | undefined` — one
  // accessor rather than thirty `?? ""` tails.
  const g = (k: string) => c[k] ?? "";
  const num = (k: string) => g(k).replace(/,/g, "").trim();
  return {
    name: g("name"),
    gstin: g("gstin"),
    reference: g("reference"),
    salesRepId: g("salesRep") ? (salesIdByName.get(g("salesRep")) ?? null) : null,
    grade: g("grade") === "" ? null : g("grade"),
    customerTypes: splitMulti(g("customerTypes")),
    industryTypes: splitMulti(g("industryTypes")),
    tags: splitMulti(g("tags")),
    panNo: g("panNo"),
    msmeUdyamNo: g("msmeUdyamNo"),
    gstRegistrationType: g("gstRegistrationType"),
    state: g("state"),
    tinNumber: g("tinNumber"),
    testCertificateNeeded: g("testCertificateNeeded") === "Yes",
    website: g("website"),
    tcsApplicable: g("tcsApplicable") === "Yes",
    paymentTerms: g("paymentTerms"),
    freightCharges: g("freightCharges"),
    creditDays: num("creditDays"),
    creditLimit: num("creditLimit"),
    transporter: g("transporter"),
    quantityDeviation: g("quantityDeviation"),
    otherReferences: g("otherReferences"),
    notes: g("notes"),
    exportClient: g("exportClient"),
    iecNumber: g("iecNumber"),
    currency: g("currency"),
    country: g("country"),
    focusedView: g("focusedView") === "Yes",
    isActive: g("isActive") === "Active",
  };
}

export function ClientMasterGrid({
  clients,
  salesPeople,
  options,
  toolbar,
}: {
  clients: ClientMasterRow[];
  salesPeople: EmployeeOption[];
  /** The same option lists the Bulk Import sheet and the KYC form read. */
  options: ClientBulkOptions;
  /** The view switch, rendered in the sheet's header bar. */
  toolbar?: React.ReactNode;
}) {
  const router = useRouter();

  const salesIdByName = React.useMemo(
    () => new Map(salesPeople.map((e) => [e.name, e.id])),
    [salesPeople],
  );

  const columns = React.useMemo<GridCol<ClientMasterRow>[]>(() => {
    // Sales Co-ordinator is a roster, not a lookup list, so it is the one
    // column the bulk loader can't fill for this screen. Same names the
    // dialog's picker offers.
    const bag: ClientBulkOptions = { ...options, salesPeople: salesPeople.map((e) => e.name) };

    return [
      // Company leads and stays pinned: a sheet this wide is unusable if
      // scrolling right loses the name of the row you're in. The Client
      // Number pins beside it and is never edited — it is issued once, and
      // every other screen refers to it.
      {
        key: "name",
        label: "Company",
        width: 220,
        kind: "text",
        maxLength: 200,
        frozen: true,
        get: (r) => clientGridCells(r).name ?? "",
      },
      {
        key: "code",
        label: "Client Number",
        width: 130,
        kind: "text",
        frozen: true,
        readOnly: true,
        mono: true,
        get: (r) => clientGridCells(r).code ?? "",
      },
      ...CLIENT_GRID_COLUMNS.filter((c) => c.key !== "name").map(
        (c): GridCol<ClientMasterRow> => ({
          key: c.key,
          label: c.label,
          width: c.width,
          kind: c.kind,
          freeText: c.freeText,
          maxLength: c.maxLength,
          options: c.optionKey ? optionsFor(c, bag) : undefined,
          get: (r) => clientGridCells(r)[c.key] ?? "",
        }),
      ),
    ];
  }, [options, salesPeople]);

  /**
   * Write one row.
   *
   * Two actions, because Product Types are `customer_product_map` rows rather
   * than a column on the client — and only when they actually changed, so a
   * credit-limit edit stays one write. They are independent, not one
   * transaction, so the row is reported saved only when both come back clean
   * and `router.refresh()` puts whichever half did land back on screen. The
   * sheet never claims more than the server took.
   */
  const save = React.useCallback(
    async (row: ClientMasterRow, cells: Cells): Promise<SaveResult> => {
      const nextProducts = splitMulti(cells.products ?? "");
      const productsChanged =
        nextProducts.length !== row.products.length ||
        nextProducts.some((p, i) => p !== row.products[i]);

      const results = await Promise.all([
        updateClientMasterRecord(row.id, clientGridPayload(cells, salesIdByName)),
        ...(productsChanged ? [updateClientProducts(row.id, nextProducts)] : []),
      ]);
      const bad = results.find((r) => !r.ok);
      if (bad && !bad.ok) return { ok: false, error: bad.error };
      router.refresh();
      return { ok: true };
    },
    [router, salesIdByName],
  );

  return (
    <MasterGrid
      rows={clients}
      columns={columns}
      title="Client Master"
      primaryKey="name"
      primarySearchLabel="Search company"
      accent={KYC_ACCENT}
      accentSoft={KYC_ACCENT_SOFT}
      toolbar={toolbar}
      save={save}
      noun="clients"
    />
  );
}
