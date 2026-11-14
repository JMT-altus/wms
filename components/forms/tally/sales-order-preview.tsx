"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, FileDown, Link2, RefreshCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import { formatInrPaise } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { partyKey } from "@/lib/tally/values";
import type { SalesOrderState, SalesOrderSummary, SalesOrderView } from "@/lib/tally/sales-orders";
import type { NameMatch, SalesOrderLinks, SalesOrderMatches } from "@/lib/tally/sales-order-match";

/**
 * The preview of a validated Sales Order file: the counts, the names the
 * masters couldn't settle (with a picker for each, for someone who holds the
 * import permission), and one row per order that opens to show its product
 * lines. Display only — every figure and every state comes from the server's
 * validation, and a match chosen here is checked there again before anything
 * is written.
 */

export interface LinkOption {
  value: string;
  label: string;
  /** The manual-entry form: the name an import reads for this record, and its unit. */
  name?: string;
  unit?: string | null;
}

const BLUE = "#0B4FB8";
const CARD: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 14px 32px -20px rgba(11, 79, 184, 0.22), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" };
const TONE: Record<SalesOrderState, { label: string; bg: string; fg: string }> = {
  valid: { label: "Valid", bg: "#ECFDF5", fg: "#047857" },
  attention: { label: "Warning", bg: "#FFFBEB", fg: "#B45309" },
  duplicate: { label: "Duplicate", bg: "#F1F5F9", fg: "#475569" },
  invalid: { label: "Invalid", bg: "#FEF2F2", fg: "#B91C1C" },
};
const MAX_ORDERS = 300;

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "#F6F8FB", border: "1px solid var(--color-hairline)" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">{label}</p>
      <p className="text-[20px] font-extrabold tabular-nums leading-tight" style={{ color: tone ?? "var(--color-ink-strong)" }}>
        {value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

const Pill = ({ state }: { state: SalesOrderState }) => (
  <span className="inline-block whitespace-nowrap rounded-pill px-2 py-0.5 text-[11.5px] font-bold" style={{ background: TONE[state].bg, color: TONE[state].fg }}>
    {TONE[state].label}
  </span>
);

const money = (paise: number | null) => (paise === null ? "—" : formatInrPaise(paise));
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) || v : v || "—");

function MatchRow({ kind, match, value, options, disabled, onLink }: { kind: "customer" | "item" | "ledger"; match: NameMatch; value: string; options: LinkOption[]; disabled: boolean; onLink: (value: string) => void }) {
  const chosen = value || (match.status === "manual" ? (match.ref ?? "") : "");
  const why = match.status === "ambiguous" ? "Several records match" : match.status === "manual" ? "Matched by hand" : kind === "customer" ? "Not in the Customer Master" : kind === "ledger" ? "Not in the Tally Ledgers list" : "Not in the Product Master";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] max-md:grid-cols-1 items-center gap-x-4 gap-y-1.5 border-t border-hairline py-2.5">
      <div className="min-w-0">
        <p className="font-semibold text-ink-strong break-words" style={{ fontSize: 13.5 }}>
          {match.name}
        </p>
        <p className="text-[12px] text-ink-subtle">
          <span className="font-semibold" style={{ color: match.status === "manual" ? BLUE : match.status === "ambiguous" ? "#B45309" : "#B91C1C" }}>
            {why}
          </span>{" "}
          · row{match.rows.length > 1 ? "s" : ""} {match.rows.join(", ")}
        </p>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <Select
            ariaLabel={`Match ${kind} ${match.name}`}
            options={options}
            value={chosen}
            onValueChange={onLink}
            disabled={disabled}
            searchable
            placeholder={kind === "customer" ? "Choose the customer…" : kind === "ledger" ? "Choose the listed ledger…" : "Choose the item…"}
            searchPlaceholder={kind === "customer" ? "Search the Customer Master…" : kind === "ledger" ? "Search the Tally Ledgers list…" : "Search the Product Master…"}
            className="h-9 text-[13px]"
          />
        </div>
        {chosen && (
          <button type="button" disabled={disabled} onClick={() => onLink("")} className="shrink-0 text-[12.5px] font-bold disabled:opacity-50" style={{ color: BLUE }} aria-label={`Clear the match for ${match.name}`}>
            Clear
          </button>
        )}
      </div>
    </li>
  );
}

export function SalesOrderPreview({
  views,
  summary,
  matches,
  links,
  options,
  canMatch,
  stale,
  busy,
  onLink,
  onRevalidate,
  onDownloadReport,
}: {
  views: SalesOrderView[];
  summary: SalesOrderSummary;
  matches: SalesOrderMatches | null;
  links: SalesOrderLinks;
  options: { customers: LinkOption[]; products: LinkOption[]; ledgers: LinkOption[] };
  canMatch: boolean;
  stale: boolean;
  busy: boolean;
  onLink: (kind: "customers" | "products" | "ledgers", key: string, value: string) => void;
  onRevalidate: () => void;
  onDownloadReport: () => void;
}) {
  const [open, setOpen] = React.useState<Set<number>>(new Set());
  const [filter, setFilter] = React.useState<SalesOrderState | "all">("all");
  const toggle = (rowNo: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(rowNo)) next.delete(rowNo);
      else next.add(rowNo);
      return next;
    });

  const needs = (m: NameMatch) => m.status !== "matched" && m.status !== "unchecked";
  const customerNeeds = matches?.customers.filter(needs) ?? [];
  const productNeeds = matches?.products.filter(needs) ?? [];
  const ledgerNeeds = matches?.ledgers?.filter(needs) ?? [];
  const unmatched = (list: NameMatch[] | undefined) => (list ?? []).filter((m) => m.status === "unmatched" || m.status === "ambiguous").length;
  /** Ledgers aren't checked while the Tally Ledgers list is empty: the tile says so instead of a misleading 0. */
  const ledgersUnchecked = (matches?.ledgers ?? []).some((m) => m.status === "unchecked");
  const productOf = new Map((matches?.products ?? []).map((m) => [m.key, m]));
  const customerOf = new Map((matches?.customers ?? []).map((m) => [m.key, m]));
  const shown = views.filter((v) => filter === "all" || v.state === filter);
  const problems = views.some((v) => v.state !== "valid");
  const FILTERS: { key: SalesOrderState | "all"; label: string; n: number }[] = [
    { key: "all", label: "All", n: views.length },
    { key: "valid", label: "Valid", n: summary.valid },
    { key: "attention", label: "Warnings", n: summary.warnings },
    { key: "invalid", label: "Invalid", n: summary.invalid },
    { key: "duplicate", label: "Duplicate", n: summary.duplicate },
  ];

  return (
    <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4">
      <section aria-labelledby="so-preview-summary" className="rounded-section bg-surface-card p-5" style={CARD}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h3 id="so-preview-summary" className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
            Validation summary
          </h3>
          {problems && (
            <button type="button" onClick={onDownloadReport} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-1.5 text-[12.5px] font-bold" style={{ color: BLUE }}>
              <FileDown size={14} strokeWidth={2.2} aria-hidden /> Download error report
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-6 max-lg:grid-cols-3 max-sm:grid-cols-2 gap-2">
          <Tile label="Sales orders" value={summary.orders} />
          <Tile label="Product lines" value={summary.lines} />
          <Tile label="Valid" value={summary.valid} tone="#047857" />
          <Tile label="Invalid" value={summary.invalid} tone="#B91C1C" />
          <Tile label="Duplicate" value={summary.duplicate} />
          <Tile label="Warnings" value={summary.warnings} tone="#B45309" />
        </div>
        {matches && (
          <div className="mt-2 grid grid-cols-3 max-sm:grid-cols-1 gap-2">
            <Tile label="Unmatched customers" value={unmatched(matches.customers)} tone={unmatched(matches.customers) ? "#B91C1C" : undefined} />
            <Tile label="Unmatched products" value={unmatched(matches.products)} tone={unmatched(matches.products) ? "#B91C1C" : undefined} />
            {ledgersUnchecked ? (
              <div className="rounded-xl px-3 py-2" style={{ background: "#F6F8FB", border: "1px solid var(--color-hairline)" }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">Unmatched ledgers</p>
                <p className="text-[13px] font-semibold leading-tight text-ink-muted">Not checked — the Tally Ledgers list (Admin &amp; Master Setup → Libraries) is empty.</p>
              </div>
            ) : (
              <Tile label="Unmatched ledgers" value={unmatched(matches.ledgers)} tone={unmatched(matches.ledgers) ? "#B91C1C" : undefined} />
            )}
          </div>
        )}
      </section>

      {(customerNeeds.length > 0 || productNeeds.length > 0 || ledgerNeeds.length > 0) && (
        <section aria-labelledby="so-preview-match" className="rounded-section bg-surface-card p-5" style={CARD}>
          <h3 id="so-preview-match" className="flex items-center gap-2 font-bold text-ink-strong" style={{ fontSize: 15 }}>
            <Link2 size={16} strokeWidth={2.2} aria-hidden style={{ color: BLUE }} /> Match customers, items and ledgers
          </h3>
          <p className="mt-1 text-[13px] text-ink-muted">
            These names in the file aren&apos;t settled by the masters. Nothing is created and nothing is guessed: choose the record each one means, or add it to the master first. An order stays out of the import until its customer and every item is
            matched.
          </p>
          {!canMatch && <p className="mt-2 text-[13px] font-semibold text-[#B45309]">Matching needs the import permission.</p>}
          {customerNeeds.length > 0 && (
            <>
              <h4 className="mt-3 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">Customers · {customerNeeds.length}</h4>
              <ul aria-label="Customers to match">
                {customerNeeds.map((m) => (
                  <MatchRow key={m.key} kind="customer" match={m} value={links.customers[m.key] ?? ""} options={options.customers} disabled={!canMatch || busy} onLink={(v) => onLink("customers", m.key, v)} />
                ))}
              </ul>
            </>
          )}
          {productNeeds.length > 0 && (
            <>
              <h4 className="mt-3 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">Items · {productNeeds.length}</h4>
              <ul aria-label="Items to match">
                {productNeeds.map((m) => (
                  <MatchRow key={m.key} kind="item" match={m} value={links.products[m.key] ?? ""} options={options.products} disabled={!canMatch || busy} onLink={(v) => onLink("products", m.key, v)} />
                ))}
              </ul>
            </>
          )}
          {ledgerNeeds.length > 0 && (
            <>
              <h4 className="mt-3 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">Ledgers · {ledgerNeeds.length}</h4>
              <ul aria-label="Ledgers to match">
                {ledgerNeeds.map((m) => (
                  <MatchRow key={m.key} kind="ledger" match={m} value={links.ledgers?.[m.key] ?? ""} options={options.ledgers} disabled={!canMatch || busy} onLink={(v) => onLink("ledgers", m.key, v)} />
                ))}
              </ul>
            </>
          )}
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button type="button" disabled={!stale || busy} onClick={onRevalidate} className="inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "linear-gradient(135deg, #0A6CFF 0%, #0B4FB8 100%)" }}>
              <RefreshCw size={14} strokeWidth={2.4} aria-hidden /> Validate again
            </button>
            <span role={stale ? "status" : undefined} className="text-[12.5px] text-ink-subtle">
              {stale ? "The matches changed. Validate again to apply them before importing." : "Choose a match, then validate again."}
            </span>
          </div>
        </section>
      )}

      <section aria-labelledby="so-preview-orders" className="rounded-section bg-surface-card p-5" style={CARD}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h3 id="so-preview-orders" className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
            Sales orders in this file
          </h3>
          <div role="group" aria-label="Show orders" className="flex flex-wrap gap-1.5">
            {FILTERS.filter((f) => f.key === "all" || f.n > 0).map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className="rounded-pill px-2.5 py-1 text-[12px] font-bold"
                style={filter === f.key ? { background: BLUE, color: "#fff" } : { background: "#EEF1F6", color: "#172B4D" }}
              >
                {f.label} · {f.n}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table aria-label="Sales orders in this file" className="w-full text-[12.5px]" style={{ minWidth: 760 }}>
            <thead>
              <tr className="text-left text-ink-subtle">
                <th className="w-8 px-1 py-1" />
                <th className="px-2 py-1 font-semibold">Row</th>
                <th className="px-2 py-1 font-semibold">Voucher no.</th>
                <th className="px-2 py-1 font-semibold">Date</th>
                <th className="px-2 py-1 font-semibold">Customer</th>
                <th className="px-2 py-1 font-semibold text-right">Lines</th>
                <th className="px-2 py-1 font-semibold text-right">Order total</th>
                <th className="px-2 py-1 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr className="border-t border-hairline">
                  <td colSpan={8} className="px-2 py-3 text-ink-subtle">
                    No orders to show.
                  </td>
                </tr>
              )}
              {shown.slice(0, MAX_ORDERS).map((v) => {
                const isOpen = open.has(v.rowNo);
                const customer = customerOf.get(partyKey(v.partyName));
                return (
                  <React.Fragment key={v.rowNo}>
                    <tr className="border-t border-hairline align-top">
                      <td className="px-1 py-1.5">
                        <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the lines of ${v.documentNo || `row ${v.rowNo}`}`} onClick={() => toggle(v.rowNo)} className="grid h-6 w-6 place-items-center rounded-md hover:bg-[#EEF1F6]" style={{ color: BLUE }}>
                          {isOpen ? <ChevronDown size={15} strokeWidth={2.4} /> : <ChevronRight size={15} strokeWidth={2.4} />}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-ink-subtle">{v.rowNo}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[12px] font-bold text-ink-strong">{v.documentNo || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{day(v.documentDate)}</td>
                      <td className="px-2 py-1.5">
                        <span className="text-ink-strong">{v.partyName || "—"}</span>
                        {customer && customer.status !== "matched" && (
                          <span className="block text-[11.5px] font-semibold" style={{ color: customer.status === "manual" ? BLUE : "#B91C1C" }}>
                            {customer.status === "manual" ? `Matched by hand: ${customer.label}` : customer.status === "ambiguous" ? "Several Customer Master records match" : "Not in the Customer Master"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{v.lines.length}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink-strong">{money(v.totalPaise)}</td>
                      <td className="px-2 py-1.5">
                        <Pill state={v.state} />
                        {v.messages.length > 0 && !isOpen && <span className="mt-0.5 block text-[11.5px] text-ink-muted">{v.messages[0]!.text}</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={7} className="px-2 pb-3">
                          {v.messages.length > 0 && (
                            <ul className="mb-2 list-disc pl-5 text-[12.5px]" style={{ color: v.state === "invalid" ? "#B91C1C" : "#475569" }}>
                              {v.messages.map((m, i) => (
                                <li key={i}>
                                  Row {m.rowNo}: {m.text}
                                </li>
                              ))}
                            </ul>
                          )}
                          {v.facts.length > 0 && (
                            <dl aria-label={`Details of ${v.documentNo || `row ${v.rowNo}`}`} className="mb-2 grid grid-cols-3 max-md:grid-cols-1 gap-x-4 gap-y-1 text-[12px]">
                              {v.facts.map((f) => (
                                <div key={f.label} className="min-w-0">
                                  <dt className="inline text-ink-subtle">{f.label}: </dt>
                                  <dd className="inline break-words text-ink-strong">{f.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {v.lines.length === 0 ? (
                            <p className="text-[12.5px] text-ink-subtle">No product lines.</p>
                          ) : (
                            <table aria-label={`Product lines of ${v.documentNo || `row ${v.rowNo}`}`} className="w-full text-[12.5px]" style={{ background: "#F6F8FB", borderRadius: 10 }}>
                              <thead>
                                <tr className="text-left text-ink-subtle">
                                  <th className="px-2 py-1 font-semibold">Row</th>
                                  <th className="px-2 py-1 font-semibold">Item in the file</th>
                                  <th className="px-2 py-1 font-semibold">Product Master</th>
                                  <th className="px-2 py-1 font-semibold text-right">Qty</th>
                                  <th className="px-2 py-1 font-semibold">Unit</th>
                                  <th className="px-2 py-1 font-semibold text-right">Rate</th>
                                  <th className="px-2 py-1 font-semibold text-right">Amount</th>
                                  <th className="px-2 py-1 font-semibold">Order due on</th>
                                  <th className="px-2 py-1 font-semibold">GST</th>
                                  <th className="px-2 py-1 font-semibold">HSN/SAC</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.lines.map((l) => {
                                  const p = productOf.get(partyKey(l.item));
                                  return (
                                    <tr key={l.rowNo} className="border-t border-hairline align-top">
                                      <td className="px-2 py-1 tabular-nums text-ink-subtle">{l.rowNo}</td>
                                      <td className="px-2 py-1 text-ink-strong">
                                        {l.item || "—"}
                                        {l.description && <span className="block text-[11.5px] text-ink-muted">{l.description}</span>}
                                      </td>
                                      <td className="px-2 py-1">
                                        {!p ? (
                                          <span className="text-ink-subtle">—</span>
                                        ) : p.label ? (
                                          <span>
                                            {p.label}
                                            {p.status === "manual" && (
                                              <span className="ml-1 text-[11px] font-bold" style={{ color: BLUE }}>
                                                by hand
                                              </span>
                                            )}
                                          </span>
                                        ) : (
                                          <span className="font-semibold text-[#B91C1C]">{p.status === "ambiguous" ? "Several items match" : "Not matched"}</span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1 text-right tabular-nums">{l.quantity || "—"}</td>
                                      <td className="px-2 py-1">{l.unit || "—"}</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{l.rate || "—"}</td>
                                      <td className="px-2 py-1 text-right tabular-nums">{money(l.amountPaise)}</td>
                                      <td className="whitespace-nowrap px-2 py-1">
                                        {l.dueDates.length ? l.dueDates.map(day).join(", ") : "—"}
                                        {l.allocations > 1 && <span className="block text-[11px] text-ink-subtle">{l.allocations} allocations</span>}
                                      </td>
                                      <td className="px-2 py-1">{l.gst || "—"}</td>
                                      <td className="px-2 py-1">{l.hsn || "—"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                          {v.ledgers.length > 0 && (
                            <table aria-label={`Ledgers of ${v.documentNo || `row ${v.rowNo}`}`} className="mt-2 w-full text-[12.5px]">
                              <thead>
                                <tr className="text-left text-ink-subtle">
                                  <th className="px-2 py-1 font-semibold">Row</th>
                                  <th className="px-2 py-1 font-semibold">Ledger</th>
                                  <th className="px-2 py-1 font-semibold text-right">Amount</th>
                                  <th className="px-2 py-1 font-semibold">Dr/Cr</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.ledgers.map((l) => (
                                  <tr key={l.rowNo} className="border-t border-hairline">
                                    <td className="px-2 py-1 tabular-nums text-ink-subtle">{l.rowNo}</td>
                                    <td className="px-2 py-1 text-ink-strong">{l.name}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{money(l.amountPaise)}</td>
                                    <td className="px-2 py-1">{l.side || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length > MAX_ORDERS && (
          <p className="mt-1 text-[12.5px] text-ink-subtle">
            Showing the first {MAX_ORDERS} of {shown.length.toLocaleString("en-IN")} orders. The error report lists every problem.
          </p>
        )}
      </section>
    </div>
  );
}
