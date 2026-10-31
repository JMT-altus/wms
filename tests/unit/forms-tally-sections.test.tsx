import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Customer Master and Tally Data Import moved from Admin & Master Setup into Forms, and every Tally category got a Forms
// section. Pure checks: the section registry, the URL state of a listing, the rail, the redirects and the moved routes.
// Nothing here touches a database.
vi.mock("next/navigation", () => ({ usePathname: () => "/forms", useRouter: () => ({}) }));

import { DOCUMENT_SECTIONS, FORMS_ROUTES, OUTSTANDING_VIEWS, TALLY_DOCUMENT_TYPES, isDocumentType, isOutstandingView, recordHref, sectionForCategory } from "@/lib/tally/sections";
import { TALLY_CATEGORY_KEYS, TALLY_CATEGORIES } from "@/lib/tally/categories";
import { listHref, pageCount, rangeLabel, readListParams, toggleSort } from "@/lib/tally/list-params";
import { navFor } from "@/components/forms/forms-sidebar";
import { MODULES } from "@/lib/nav-modules";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const exists = (p: string) => existsSync(resolve(ROOT, p));

describe("every Tally category has a Forms section", () => {
  it("the seven document types are the category keys themselves, so a ledger filters on exactly what the import stored", () => {
    const documentCategories = TALLY_CATEGORY_KEYS.filter((k) => TALLY_CATEGORIES[k].kind === "document");
    expect([...TALLY_DOCUMENT_TYPES].sort()).toEqual([...documentCategories].sort());
    for (const t of TALLY_DOCUMENT_TYPES) {
      expect(DOCUMENT_SECTIONS[t].href).toBe(`/forms/documents/${t}`);
      expect(DOCUMENT_SECTIONS[t].party).toBe(TALLY_CATEGORIES[t].party);
    }
    expect(isDocumentType("sales-invoices")).toBe(true);
    expect(isDocumentType("customer-master")).toBe(false);
    expect(isDocumentType("outstanding-balances")).toBe(false);
  });

  it("maps each import category to the section that shows its records, outstanding by direction", () => {
    expect(sectionForCategory("customer-master", null)).toEqual({ label: "Customer Master", href: "/forms/customer-master" });
    expect(sectionForCategory("vendor-master", null)).toEqual({ label: "Vendor Master", href: "/forms/vendor-master" });
    expect(sectionForCategory("sales-orders", null).href).toBe("/forms/documents/sales-orders");
    expect(sectionForCategory("sales-invoices", null).href).toBe("/forms/documents/sales-invoices");
    expect(sectionForCategory("outstanding-balances", "receivable").href).toBe("/forms/outstanding/receivables");
    expect(sectionForCategory("outstanding-balances", "payable").href).toBe("/forms/outstanding/payables");
    expect(OUTSTANDING_VIEWS.receivables.direction).toBe("receivable");
    expect(OUTSTANDING_VIEWS.payables.direction).toBe("payable");
    expect(isOutstandingView("receivables") && isOutstandingView("payables") && !isOutstandingView("receivable")).toBe(true);
  });

  it("an import row's target table + id opens the record's own page, never a different ledger", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(recordHref("customer_masters", id, { category: "customer-master", direction: null })).toBe("/forms/customer-master");
    expect(recordHref("vendor_masters", id, { category: "vendor-master", direction: null })).toBe(`/forms/vendor-master/${id}`);
    expect(recordHref("tally_documents", id, { category: "credit-notes", direction: null })).toBe(`/forms/documents/credit-notes/${id}`);
    expect(recordHref("tally_outstanding_lines", id, { category: "outstanding-balances", direction: "payable" })).toBe(`/forms/outstanding/payables/${id}`);
    expect(recordHref("tally_documents", null, { category: "sales-orders", direction: null })).toBeNull();
    expect(recordHref("tally_documents", id, { category: "customer-master", direction: null })).toBeNull();
    expect(recordHref("somewhere_else", id, { category: "sales-orders", direction: null })).toBeNull();
  });
});

describe("the URL is the listing's state", () => {
  const SORTS = ["documentDate", "documentNo", "totalPaise"] as const;
  const defaults = { sort: "documentDate", dir: "desc" } as const;

  it("reads search, filters, paging and sort, and falls back on anything unparseable", () => {
    const p = readListParams({ q: "  INV/1 ", fy: "2025-26", from: "2025-04-01", to: "2026-03-31", batch: "11111111-1111-4111-8111-111111111111", page: "3", size: "25", sort: "totalPaise", dir: "asc" }, SORTS, defaults);
    expect(p).toMatchObject({ q: "INV/1", fy: "2025-26", from: "2025-04-01", to: "2026-03-31", batch: "11111111-1111-4111-8111-111111111111", page: 3, size: 25, sort: "totalPaise", dir: "asc" });
    const bad = readListParams({ fy: "FY25", from: "yesterday", batch: "drop table", page: "-4", size: "7", sort: "amount", dir: "sideways" }, SORTS, defaults);
    expect(bad).toMatchObject({ fy: null, from: null, batch: null, page: 1, size: 50, sort: "documentDate", dir: "desc" });
    expect(readListParams(undefined, SORTS, defaults).page).toBe(1);
    // A reversed range is read the way it was meant; a sort named without a direction starts ascending.
    expect(readListParams({ from: "2026-03-31", to: "2025-04-01", sort: "documentNo" }, SORTS, defaults)).toMatchObject({ from: "2025-04-01", to: "2026-03-31", sort: "documentNo", dir: "asc" });
  });

  it("writes links that keep the state, flip a sort, and leave defaults out", () => {
    const p = readListParams({ q: "alpha", sort: "documentNo", dir: "asc", page: "2" }, SORTS, defaults);
    expect(listHref("/forms/documents/sales-orders", p)).toBe("/forms/documents/sales-orders?q=alpha&sort=documentNo&dir=asc&page=2");
    expect(listHref("/forms/documents/sales-orders", p, toggleSort(p, "documentNo"))).toBe("/forms/documents/sales-orders?q=alpha&sort=documentNo&dir=desc");
    expect(listHref("/forms/documents/sales-orders", p, toggleSort(p, "totalPaise"))).toBe("/forms/documents/sales-orders?q=alpha&sort=totalPaise&dir=asc");
    expect(listHref("/x", { ...p, q: "", page: 1, size: 50 })).toBe("/x?sort=documentNo&dir=asc");
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(101, 50)).toBe(3);
    expect(rangeLabel(0, 1, 50, "documents")).toBe("No documents");
    expect(rangeLabel(12, 1, 50, "documents")).toBe("12 documents");
    expect(rangeLabel(312, 2, 50, "documents")).toBe("51–100 of 312 documents");
  });
});

describe("the Forms rail", () => {
  const hrefs = (isAdmin: boolean) => navFor(isAdmin).map((i) => String(i.href));

  it("lists Overview, Client KYC, the masters and every Tally section, in groups", () => {
    const all = hrefs(true);
    expect(all[0]).toBe("/forms");
    expect(all).toContain("/forms/client-kyc/new");
    expect(all).toContain("/forms/customer-master");
    expect(all).toContain("/forms/vendor-master");
    expect(all).toContain("/forms/tally-import");
    for (const t of TALLY_DOCUMENT_TYPES) expect(all).toContain(`/forms/documents/${t}`);
    expect(all).toContain("/forms/outstanding/receivables");
    expect(all.some((h) => h.includes("/collection"))).toBe(false);
    expect(navFor(true).filter((i) => i.groupLabel).map((i) => i.groupLabel)).toEqual(["Client KYC", "Masters", "Tally"]);
    const labels = navFor(true).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(["Overview", "Customer Master", "Vendor Master", "Tally Data Import", "Sales Orders", "Sales Invoices", "Purchase Invoices", "Credit Notes", "Debit Notes", "Customer Receipts", "Vendor Payments", "Outstanding Balances"]));
  });

  it("hides the two admin-only rows from everyone else and moves the group heading to the next row; the server gates them regardless", () => {
    const staff = hrefs(false);
    expect(staff).not.toContain("/forms/customer-master");
    expect(staff).not.toContain("/forms/tally-import");
    expect(staff).toContain("/forms/vendor-master");
    expect(staff).toContain("/forms/documents/sales-orders");
    expect(navFor(false).find((i) => String(i.href) === "/forms/vendor-master")?.groupLabel).toBe("Masters");
    expect(navFor(false).find((i) => String(i.href) === "/forms/documents/sales-orders")?.groupLabel).toBe("Tally");
    expect(read("app/(forms-module)/forms/customer-master/page.tsx")).toMatch(/await requireAdmin\(\)/);
    expect(read("app/(forms-module)/forms/tally-import/page.tsx")).toMatch(/await requireAdmin\(\)/);
  });
});

describe("the move out of Admin & Master Setup", () => {
  it("the old pages are gone, the new ones exist, and the old URLs redirect", () => {
    expect(exists("app/(masters)/master-setup/customers/page.tsx")).toBe(false);
    expect(exists("app/(masters)/master-setup/tally-import/page.tsx")).toBe(false);
    expect(exists("app/(masters)/master-setup/tally-import/actions.ts")).toBe(false);
    for (const p of ["customer-master/page.tsx", "tally-import/page.tsx", "tally-import/actions.ts", "tally-import/batches/[id]/page.tsx", "vendor-master/page.tsx", "vendor-master/[id]/page.tsx", "documents/[type]/page.tsx", "documents/[type]/[id]/page.tsx", "outstanding/[view]/page.tsx", "outstanding/[view]/[id]/page.tsx", "page.tsx", "loading.tsx", "error.tsx"]) {
      expect(exists(`app/(forms-module)/forms/${p}`), p).toBe(true);
    }
    const config = read("next.config.ts");
    expect(config).toMatch(/source: "\/master-setup\/customers", destination: "\/forms\/customer-master"/);
    expect(config).toMatch(/source: "\/master-setup\/tally-import", destination: "\/forms\/tally-import"/);
    expect(config).toMatch(/source: "\/master-setup\/tally-import\/:path\*", destination: "\/forms\/tally-import\/:path\*"/);
  });

  it("the Master Setup rail and overview no longer list them; the rest of Master Setup is untouched", () => {
    const rail = read("components/admin/master/master-sidebar.tsx");
    expect(rail).not.toMatch(/\/master-setup\/customers"/);
    expect(rail).not.toMatch(/\/master-setup\/tally-import"/);
    for (const kept of ["/master-setup/products", "/master-setup/libraries", "/master-setup/access-control", "/master-setup/data-import", "/master-setup/collection-weekly-upload"]) expect(rail).toContain(`"${kept}"`);
    expect(read("app/(masters)/master-setup/page.tsx")).not.toMatch(/\/master-setup\/customers/);
    // Nothing in the app still links to the old routes except the redirects and comments.
    for (const f of ["components/admin/master/tally-import-shell.tsx", "app/(masters)/master-setup/actions.ts", "app/(masters-module)/masters/actions.ts", "app/(forms-module)/forms/client-kyc/actions.ts"]) {
      expect(read(f), f).not.toMatch(/"\/master-setup\/(customers|tally-import)"/);
    }
  });

  it("the hub tile lands on the overview, and the Forms module still covers every new URL", () => {
    expect(MODULES.find((m) => m.id === "forms")).toMatchObject({ landing: "/forms", routes: ["/forms"] });
    expect(FORMS_ROUTES.overview).toBe("/forms");
  });

  it("the import actions check the Forms module, admin and the sensitive permission — a Forms grant never implies importing", () => {
    const actions = read("app/(forms-module)/forms/tally-import/actions.ts");
    expect(actions).toMatch(/canAccessModule\("forms"\)/);
    expect(actions).toMatch(/await requireAdmin\(\)/);
    expect(actions).toMatch(/requireCapability\("tally\.import"\)/);
    expect(read("db/enums.ts")).toMatch(/key: "tally\.import",[\s\S]*?sensitive: true/);
    // Viewing the ledgers needs the module only, through the typed proof every query requires.
    expect(read("lib/queries/tally-ledger.ts")).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(read("lib/queries/tally-ledger.ts")).toMatch(/_v: FormsViewer|v: FormsViewer/);
  });
});
