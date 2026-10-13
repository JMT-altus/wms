"use client";

import * as React from "react";
import {
  Banknote,
  Building2,
  FileDown,
  FileInput,
  FileSpreadsheet,
  FileText,
  Receipt,
  ReceiptText,
  Scale,
  ShoppingCart,
  Truck,
  UploadCloud,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Tally Data Import — structure only.
 *
 * Nothing here reads, parses or stores a file, and nothing writes to the
 * database. The category choice is local view state so the layout can be
 * reviewed; every action that would import is disabled and labelled as not
 * built yet. The category `key`s are the stable identifiers a future importer
 * (and the Incentive Tracker feed) can hang off.
 */

interface Category {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const CATEGORIES: ReadonlyArray<Category> = [
  { key: "customer-master", label: "Customer Master", hint: "Ledgers under Sundry Debtors", icon: Users },
  { key: "vendor-master", label: "Vendor Master", hint: "Ledgers under Sundry Creditors", icon: Building2 },
  { key: "sales-orders", label: "Sales Orders", hint: "Open and fulfilled orders", icon: ShoppingCart },
  { key: "sales-invoices", label: "Sales Invoices / Tax Invoices", hint: "Sales vouchers", icon: ReceiptText },
  { key: "purchase-invoices", label: "Purchase Invoices", hint: "Purchase vouchers", icon: Truck },
  { key: "credit-notes", label: "Credit Notes", hint: "Sales returns and adjustments", icon: FileInput },
  { key: "debit-notes", label: "Debit Notes", hint: "Purchase returns and adjustments", icon: FileDown },
  { key: "customer-receipts", label: "Customer Receipts (Cash/Bank)", hint: "Receipt vouchers", icon: Banknote },
  { key: "vendor-payments", label: "Vendor Payments (Cash/Bank)", hint: "Payment vouchers", icon: Receipt },
  { key: "outstanding-balances", label: "Outstanding Balances", hint: "Bills receivable and payable", icon: Scale },
];

const PLACEHOLDERS: ReadonlyArray<{ title: string; body: string }> = [
  { title: "File preview", body: "The first rows of the chosen file will appear here before anything is imported." },
  { title: "Column mapping", body: "Tally columns will be matched to WMS fields here, reusing the saved mappings." },
  { title: "Validation summary", body: "Missing, duplicate and mismatched rows will be listed here before import." },
  { title: "Import history", body: "Past imports, who ran them and when will be listed here." },
  { title: "Record counts", body: "Rows read, accepted, skipped and imported will be shown here." },
];

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--color-hairline)",
  boxShadow: "0 14px 32px -20px rgba(245, 158, 11, 0.2), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
};

function NotBuilt() {
  return (
    <span
      className="rounded-pill px-2.5 py-0.5 font-bold uppercase tracking-wider"
      style={{
        fontSize: 10.5,
        background: "var(--color-amber-bg)",
        color: "var(--color-amber-deep)",
        border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)",
      }}
    >
      Not implemented yet
    </span>
  );
}

export function TallyImportShell() {
  const [selected, setSelected] = React.useState<string | null>(null);
  const category = CATEGORIES.find((c) => c.key === selected) ?? null;

  return (
    <div className="space-y-8">
      <div
        role="note"
        className="rounded-section px-5 py-4 text-ink-muted"
        style={{
          fontSize: 14,
          background: "var(--color-amber-bg)",
          border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)",
        }}
      >
        <strong className="text-ink-strong">Preview of the layout.</strong> Uploading, validation and
        import are not built yet. Nothing on this page reads or saves a file, and no data is changed.
      </div>

      <section aria-labelledby="tally-category">
        <h2 id="tally-category" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          1 · What are you importing?
        </h2>
        <div className="mt-3 grid grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-3">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const on = c.key === selected;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(on ? null : c.key)}
                className="rounded-section bg-surface-card p-4 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
                style={{
                  ...CARD_STYLE,
                  border: on ? "1.5px solid var(--color-amber-deep)" : CARD_STYLE.border,
                }}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="grid place-items-center rounded-xl shrink-0"
                    style={{
                      width: 38,
                      height: 38,
                      background: "color-mix(in srgb, var(--color-amber) 15%, transparent)",
                      color: "var(--color-amber-deep)",
                    }}
                  >
                    <Icon size={18} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
                      {c.label}
                    </span>
                    <span className="block mt-0.5 text-ink-muted" style={{ fontSize: 12.5 }}>
                      {c.hint}
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="tally-upload">
        <h2 id="tally-upload" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          2 · Upload the export
        </h2>
        <div className="mt-3 rounded-section bg-surface-card p-6" style={CARD_STYLE}>
          <div
            className="rounded-xl px-6 py-10 text-center"
            style={{ border: "2px dashed var(--color-hairline)", background: "var(--color-surface-soft)" }}
          >
            <UploadCloud size={34} strokeWidth={1.8} className="mx-auto text-ink-subtle" aria-hidden />
            <p className="mt-3 font-bold text-ink-strong" style={{ fontSize: 15 }}>
              {category ? `Upload file for ${category.label}` : "Choose a category above, then upload its export"}
            </p>
            <p className="mt-1 text-ink-muted" style={{ fontSize: 13 }}>
              Drag and drop a file here, or choose one from your computer.
            </p>
            <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="rounded-pill px-5 py-2.5 font-bold cursor-not-allowed"
                style={{ fontSize: 14, background: "var(--color-surface-track)", color: "var(--color-ink-subtle)" }}
              >
                Upload file
              </button>
              <NotBuilt />
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-3 max-md:grid-cols-1 gap-4" style={{ fontSize: 13 }}>
            <div className="flex items-start gap-2.5">
              <FileSpreadsheet size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Formats</dt>
                <dd className="text-ink-muted">Excel (.xlsx) or CSV (.csv), exported from Tally.</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FileText size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Layout</dt>
                <dd className="text-ink-muted">One header row, one record per row, no merged cells.</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FileInput size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Limits</dt>
                <dd className="text-ink-muted">Size and row limits will be confirmed when import is built.</dd>
              </div>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="tally-after">
        <h2 id="tally-after" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          3 · Review and import
        </h2>
        <div className="mt-3 grid grid-cols-2 max-lg:grid-cols-1 gap-4">
          {PLACEHOLDERS.map((p) => (
            <div key={p.title} className="rounded-section bg-surface-card p-5" style={CARD_STYLE}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
                  {p.title}
                </h3>
                <NotBuilt />
              </div>
              <p className="mt-2 text-ink-muted" style={{ fontSize: 13.5 }}>
                {p.body}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="rounded-pill px-5 py-2.5 font-bold cursor-not-allowed"
            style={{ fontSize: 14, background: "var(--color-surface-track)", color: "var(--color-ink-subtle)" }}
          >
            Import
          </button>
          <span className="text-ink-subtle" style={{ fontSize: 12.5 }}>
            Disabled until import is built. Imported records will later feed the Incentive Tracker.
          </span>
        </div>
      </section>
    </div>
  );
}
