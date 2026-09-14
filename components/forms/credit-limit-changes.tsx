"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, CircleSlash, Sparkles } from "lucide-react";
import { formatInr } from "@/lib/format";
import type { CreditLimitChange } from "@/lib/masters/credit-limit";
import type { ClientMasterRow } from "@/lib/queries/client-kyc";
import type { EmployeeOption } from "@/lib/queries/employees";
import { ViewSwitch, type MasterView } from "@/components/admin/master/view-switch";
import { CreditLimitGrid, lastChangeByClient } from "./credit-limit-grid";
import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./kyc/tokens";

/**
 * Credit Limit — what has moved, and by how much.
 *
 * Its own section beside the Client Master: the same register read along a
 * different axis. The table answers "what is this client's limit", this
 * answers "whose limit changed, which way, and who changed it". The column on
 * the table can only ever show the current figure — the previous one is
 * overwritten the moment someone edits it — so without this the decision
 * behind a number is unrecoverable.
 *
 * Fed by `customer_credit_limit_events`, written by every action that touches
 * the column, so this is the whole story rather than the part one screen
 * remembered to log.
 *
 * A limit set for the first time and a limit cleared are their own rows, not
 * counted as an increase from zero or a decrease to it: "raised to ₹5,00,000"
 * and "given a limit of ₹5,00,000" are different events.
 */

type Filter = "all" | "increased" | "decreased";

const TONE = {
  increased: { color: "var(--color-green-deep)", soft: "color-mix(in srgb, var(--color-green) 10%, transparent)" },
  decreased: { color: "var(--color-red-deep)", soft: "color-mix(in srgb, var(--color-red) 10%, transparent)" },
  set: { color: KYC_ACCENT, soft: KYC_ACCENT_SOFT },
  cleared: { color: "var(--color-ink-muted)", soft: "var(--color-surface-soft)" },
} as const;

const LABEL = {
  increased: "Increased",
  decreased: "Decreased",
  set: "First set",
  cleared: "Cleared",
} as const;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const money = (v: string | null) => (v === null ? "—" : formatInr(Number(v)));

export function CreditLimitChanges({
  changes,
  totals,
  clients,
  salesPeople,
  paymentTerms,
}: {
  changes: CreditLimitChange[];
  totals: { up: number; down: number };
  /** The register the Grid view edits. */
  clients: ClientMasterRow[];
  salesPeople: EmployeeOption[];
  paymentTerms: string[];
}) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  /**
   * Table is the history; Grid is where limits are set.
   *
   * The same switch every other master carries, but the two halves are not
   * two readings of one list here — they are the record and the thing that
   * writes it. Editing in Grid puts rows into Table, which is why they belong
   * on one screen rather than two.
   */
  const [view, setView] = React.useState<MasterView>("table");

  const viewSwitch = (
    <ViewSwitch
      view={view}
      onChange={setView}
      accent={KYC_ACCENT}
      tableHint="Every change, newest first"
      gridHint="Set credit limits, a row per client"
    />
  );

  /**
   * The direction chips, drawn once and shown in both views.
   *
   * Deliberately ONE piece of state rather than a filter per view: the two
   * halves are the same review read two ways, so narrowing to "reduced" in
   * the history and then switching to Grid should hand you the clients whose
   * limits were reduced — not silently start again at All.
   *
   * What it filters differs, because the two views list different things. In
   * Table it is the CHANGES; in Grid it is the CLIENTS, by what their last
   * change did.
   */
  const chips = (
    <div
      className="inline-flex items-center rounded-chip p-0.5 bg-surface-soft"
      style={{ border: "1px solid var(--color-hairline)" }}
      role="group"
      aria-label="Filter by direction"
    >
      {(["all", "increased", "decreased"] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => setFilter(f)}
          aria-pressed={filter === f}
          className="rounded-chip px-2.5 h-7 text-[12.5px] font-semibold whitespace-nowrap transition-colors"
          style={
            filter === f ? { background: KYC_ACCENT, color: "#fff" } : { color: "var(--color-ink-soft)" }
          }
        >
          {f === "all" ? "All" : LABEL[f]}
        </button>
      ))}
    </div>
  );

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return changes.filter((c) => {
      if (filter !== "all" && c.direction !== filter) return false;
      if (!q) return true;
      return (
        c.client.toLowerCase().includes(q) ||
        (c.code ?? "").toLowerCase().includes(q) ||
        (c.changedByName ?? "").toLowerCase().includes(q)
      );
    });
  }, [changes, filter, query]);

  const lastByClient = React.useMemo(() => lastChangeByClient(changes), [changes]);
  const gridClients = React.useMemo(
    () =>
      filter === "all"
        ? clients
        : clients.filter((c) => lastByClient.get(c.id)?.direction === filter),
    [clients, filter, lastByClient],
  );

  if (view === "grid") {
    return (
      <CreditLimitGrid
        clients={gridClients}
        // Unfiltered: the grid's Last Change column is the client's own last
        // move, not "its last move that matched the chip up there".
        changes={changes}
        salesPeople={salesPeople}
        paymentTerms={paymentTerms}
        toolbar={viewSwitch}
        leading={chips}
        // Only while a chip is narrowing the list. With the chip on All an
        // empty sheet really does mean there are no clients, which is what
        // the sheet's own wording already says.
        emptyTitle={
          filter === "all"
            ? undefined
            : `No client's credit limit was last ${filter === "increased" ? "raised" : "reduced"}.`
        }
      />
    );
  }

  return (
    <section
      className="rounded-section bg-surface-card overflow-hidden"
      style={{
        border: "2px solid var(--color-table-edge)",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      }}
    >
      <header
        className="flex items-center gap-3 flex-wrap px-4 py-3"
        style={{ borderBottom: "1px solid var(--color-hairline)" }}
      >
        <h2
          className="font-bold text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: 17 }}
        >
          Credit Limit
        </h2>
        <span className="text-ink-subtle" style={{ fontSize: 12.5 }}>
          Every change, newest first
        </span>

        <span className="flex items-center gap-1.5 ml-1">
          <Tile tone="increased" count={totals.up} label="raised" />
          <Tile tone="decreased" count={totals.down} label="reduced" />
        </span>

        <div className="ml-auto flex items-center gap-2">
          {chips}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client or who changed it"
            aria-label="Search credit limit changes"
            className="rounded-chip px-3 h-8 bg-surface-soft border border-hairline outline-none text-[12.5px] text-ink-strong"
            style={{ width: 240 }}
          />
          {viewSwitch}
        </div>
      </header>

      <div className="data-grid-scroll overflow-y-auto" style={{ maxHeight: 420 }}>
        <table className="data-grid">
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Client Number</Th>
              <Th>Change</Th>
              <Th align="right">From</Th>
              <Th align="right">To</Th>
              <Th align="right">Difference</Th>
              <Th>Changed by</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-ink-muted"
                  style={{ fontSize: 13.5 }}
                >
                  {changes.length === 0
                    ? "No credit limit has changed yet. Changes appear here as soon as one does."
                    : "Nothing matches that filter."}
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const tone = TONE[c.direction];
              return (
                <tr key={c.id} className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                  <Td>
                    <strong className="text-ink-strong">{c.client}</strong>
                  </Td>
                  <Td mono>{c.code ?? "—"}</Td>
                  <Td>
                    <span
                      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-semibold"
                      style={{ fontSize: 11.5, background: tone.soft, color: tone.color }}
                    >
                      {c.direction === "increased" && <ArrowUpRight size={12} strokeWidth={2.8} />}
                      {c.direction === "decreased" && <ArrowDownRight size={12} strokeWidth={2.8} />}
                      {c.direction === "set" && <Sparkles size={12} strokeWidth={2.6} />}
                      {c.direction === "cleared" && <CircleSlash size={12} strokeWidth={2.6} />}
                      {LABEL[c.direction]}
                    </span>
                  </Td>
                  <Td align="right" muted>
                    {money(c.previousLimit)}
                  </Td>
                  <Td align="right">
                    <strong className="text-ink-strong">{money(c.newLimit)}</strong>
                  </Td>
                  <Td align="right">
                    {/* Signed, because the size of a change is the point — a
                        limit that moved by a lakh and one that moved by five
                        hundred are not the same decision. */}
                    <span className="tabular-nums font-semibold" style={{ color: tone.color }}>
                      {c.delta > 0 ? "+" : c.delta < 0 ? "−" : ""}
                      {formatInr(Math.abs(c.delta))}
                    </span>
                  </Td>
                  <Td muted>{c.changedByName ?? "—"}</Td>
                  <Td muted>{when(c.changedAt)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tile({
  tone,
  count,
  label,
}: {
  tone: "increased" | "decreased";
  count: number;
  label: string;
}) {
  const t = TONE[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 h-7 font-semibold whitespace-nowrap"
      style={{ fontSize: 12.5, background: t.soft, color: t.color }}
    >
      {tone === "increased" ? (
        <ArrowUpRight size={13} strokeWidth={2.8} />
      ) : (
        <ArrowDownRight size={13} strokeWidth={2.8} />
      )}
      {count} {label}
    </span>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: "right" }) {
  return (
    <th
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "color-mix(in srgb, var(--color-blue) 8%, var(--color-surface-soft))",
        backdropFilter: "blur(6px)",
        padding: "8px 12px",
        textAlign: align ?? "left",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--color-ink-soft)",
        whiteSpace: "nowrap",
        borderBottom: "2px solid var(--color-table-edge)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  muted,
  mono,
}: {
  children: React.ReactNode;
  align?: "right";
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={muted ? "text-ink-muted" : "text-ink-soft"}
      style={{
        padding: "8px 12px",
        textAlign: align ?? "left",
        fontSize: 13,
        whiteSpace: "nowrap",
        ...(mono
          ? { fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 12 }
          : null),
      }}
    >
      {children}
    </td>
  );
}
