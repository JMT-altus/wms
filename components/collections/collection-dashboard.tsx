"use client";

import * as React from "react";
import { formatInr } from "@/lib/format";
import { NOT_CONNECTED_MESSAGE } from "@/lib/collections/source";
import { outstandingByPerson, personSummary, topByOutstanding, type PartyRow } from "@/lib/collections/derive";
import { HBars } from "@/components/charts/h-bars";
import { Donut } from "@/components/charts/donut";

const CARD = { border: "1px solid var(--color-hairline-strong)", boxShadow: "0 1px 2px rgba(15,23,42,0.05)" } as const;
const FIELD = "h-8 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong";
const PALETTE = ["#0A6CFF", "#12B3A0", "#7C3AED", "#F59E0B", "#E11D48", "#0891B2", "#64748B", "#16A34A"];
const DASH = "—";

/**
 * The Collection Dashboard — a management overview of the same party rows the
 * Tracker lists, so the two can never disagree.
 *
 * What is NOT computed here, on purpose:
 *   - Total Outstanding is shown only when the source supplied an outstanding
 *     figure for every party; this screen never derives it from debit and credit
 *     (that rule is unconfirmed).
 *   - Overdue Follow-ups and Priority Collections depend on status and priority
 *     rules that are still to be agreed, so they say so instead of guessing.
 * Anything with no data shows an em dash or a plain message — never a made-up number.
 */
export function CollectionDashboard({
  rows,
  connected,
}: {
  rows: PartyRow[];
  connected: boolean;
}) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [party, setParty] = React.useState("");
  const [person, setPerson] = React.useState("");

  const people = React.useMemo(
    () => [...new Set(rows.map((r) => r.collectionPerson).filter((p): p is string => Boolean(p)))].sort(),
    [rows],
  );

  // The filters narrow the rows every section below is built from.
  const scoped = React.useMemo(() => {
    const q = party.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.partyName.toLowerCase().includes(q)) return false;
      if (person && r.collectionPerson !== person) return false;
      if (from || to) {
        if (!r.nextFollowupDate) return false;
        if (from && r.nextFollowupDate < from) return false;
        if (to && r.nextFollowupDate > to) return false;
      }
      return true;
    });
  }, [rows, from, to, party, person]);

  const hasData = connected && scoped.length > 0;
  const allSupplied = hasData && scoped.every((r) => r.outstanding !== null);
  const totalOutstanding = allSupplied ? scoped.reduce((s, r) => s + (r.outstanding ?? 0), 0) : null;
  const persons = new Set(scoped.map((r) => r.collectionPerson).filter(Boolean)).size;

  const ranked = topByOutstanding(scoped, Number.POSITIVE_INFINITY);
  const top5 = ranked.slice(0, 5);
  const top10 = ranked.slice(0, 10);
  const byPerson = outstandingByPerson(scoped);
  const personRows = personSummary(scoped);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-soft">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${FIELD} tabular-nums`} />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-soft">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={`${FIELD} tabular-nums`} />
        </label>
        <input
          type="search"
          value={party}
          onChange={(e) => setParty(e.target.value)}
          placeholder="Party name"
          aria-label="Party name"
          className={`${FIELD} w-[200px]`}
        />
        <select aria-label="Collection person" value={person} onChange={(e) => setPerson(e.target.value)} className={FIELD}>
          <option value="">All collection persons</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {(from || to || party || person) && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              setParty("");
              setPerson("");
            }}
            className="h-8 rounded-lg px-2.5 text-[13px] font-semibold text-ink-subtle hover:bg-[#EEF2F8] hover:text-ink-strong"
          >
            Reset
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2.5 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <Stat label="Total outstanding" value={totalOutstanding === null ? DASH : formatInr(totalOutstanding)} accent="#0A6CFF" />
        <Stat label="Total parties" value={hasData ? String(scoped.length) : DASH} accent="#12B3A0" />
        <Stat label="Overdue follow-ups" value={DASH} accent="#E11D48" hint="Needs the agreed overdue rule" />
        <Stat label="Collection persons" value={hasData && persons > 0 ? String(persons) : DASH} accent="#7C3AED" />
      </div>

      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <Panel title="Party-wise outstanding" empty={!hasData || ranked.length === 0}>
          {/* Every party with a supplied figure, in a scrolling frame so a long list
              stays readable instead of stretching the page. */}
          <div className="max-h-[360px] overflow-y-auto pr-1">
            <HBars
              data={ranked.map((p) => ({ label: p.partyName, value: p.outstanding as number }))}
              height={Math.max(180, ranked.length * 30)}
            />
          </div>
        </Panel>

        <Panel title="Top 5 parties by outstanding" empty={!hasData || top5.length === 0}>
          <ChartWithLegend
            slices={top5.map((p, i) => ({ label: p.partyName, value: p.outstanding as number, color: PALETTE[i % PALETTE.length]! }))}
          />
        </Panel>

        <Panel title="Outstanding by collection person" empty={!hasData || byPerson.length === 0}>
          <HBars data={byPerson.map((p) => ({ label: p.person, value: p.total }))} height={Math.max(160, byPerson.length * 34)} />
        </Panel>

        <Panel title="Collection person share" empty={!hasData || byPerson.length === 0}>
          <ChartWithLegend
            solid
            slices={byPerson.map((p, i) => ({ label: p.person, value: p.total, color: PALETTE[i % PALETTE.length]! }))}
          />
        </Panel>

        <Panel title="Collection person-wise outstanding" empty={!hasData || personRows.length === 0}>
          <FullTable
            head={["Collection person", "Parties", "Outstanding"]}
            widths={["46%", "22%", "32%"]}
            right={[1, 2]}
            rows={personRows.map((p) => [p.person, String(p.parties), p.total === null ? DASH : formatInr(p.total)])}
          />
        </Panel>

        <Panel title="Top 10 outstanding parties" empty={!hasData || top10.length === 0}>
          <FullTable
            head={["Party name", "Outstanding", "Collection person"]}
            widths={["46%", "24%", "30%"]}
            right={[1]}
            rows={top10.map((p) => [p.partyName, formatInr(p.outstanding as number), p.collectionPerson ?? DASH])}
          />
        </Panel>

        <Panel title="Priority collections" empty={false} wide>
          {/* The columns are in place; the rows wait for the priority rule (for example
              high amount, or due date passed), which has not been confirmed. */}
          <FullTable
            head={["Party name", "Outstanding", "Collection person", "Next follow-up"]}
            widths={["35%", "20%", "25%", "20%"]}
            right={[1]}
            rows={[]}
            empty={{
              title: "No priority collections to display yet.",
              detail: "The priority rule (for example high amount or due date passed) has not been confirmed yet.",
            }}
          />
        </Panel>
      </div>
    </div>
  );
}

function ChartWithLegend({
  slices,
  solid = false,
}: {
  slices: { label: string; value: number; color: string }[];
  solid?: boolean;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Donut data={slices} size={180} solid={solid} />
      <ul className="min-w-[160px] flex-1 grid gap-1.5 text-[13px]">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate font-medium text-ink-strong">{s.label}</span>
            <span className="tabular-nums text-ink-soft">{formatInr(s.value)}</span>
            <span className="w-10 text-right tabular-nums text-ink-subtle">
              {total > 0 ? `${Math.round((s.value / total) * 100)}%` : DASH}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A full-width table with fixed column widths, so headings and values line up
 * from row to row, long party names truncate (with the full name on hover)
 * instead of pushing the other columns about, and the numeric column is
 * right-aligned.
 */
function FullTable({
  head,
  widths,
  right,
  rows,
  empty,
}: {
  head: string[];
  widths: string[];
  /** Indexes of right-aligned columns. */
  right: number[];
  rows: string[][];
  /** Shown as one centred row across the table when there are no rows. */
  empty?: { title: string; detail?: string };
}) {
  const align = (i: number) => (right.includes(i) ? "text-right" : "text-left");
  return (
    // Scrolls sideways on a small screen rather than squeezing the columns.
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[560px] table-fixed text-[13px]">
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-[#F5F7FB] text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`px-3 py-2 first:rounded-l-lg last:rounded-r-lg ${align(i)}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-[#EEF1F6] first:border-t-0 hover:bg-[#F7F9FD]">
              {r.map((c, i) => (
                <td
                  key={i}
                  title={c}
                  className={`truncate px-3 py-2 ${align(i)} ${i === 0 ? "font-semibold text-ink-strong" : "tabular-nums text-ink-soft"}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && empty && (
            <tr>
              <td colSpan={head.length} className="px-3 py-7 text-center align-middle">
                <p className="text-[13px] font-medium text-ink-muted">{empty.title}</p>
                {empty.detail && <p className="mt-0.5 text-[12px] text-ink-subtle">{empty.detail}</p>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, accent, hint }: { label: string; value: string; accent: string; hint?: string }) {
  return (
    <div className="relative overflow-hidden rounded-section bg-white px-3.5 py-3" style={CARD} title={hint}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <p className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">{label}</p>
      <p className="mt-1.5 text-[24px] font-extrabold leading-none tabular-nums text-ink-strong">{value}</p>
    </div>
  );
}

function Panel({
  title,
  empty,
  note,
  wide = false,
  children,
}: {
  title: string;
  empty: boolean;
  note?: string;
  /** Span the whole row of the two-column grid. */
  wide?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-section bg-white p-4 ${wide ? "col-span-2 max-lg:col-span-1" : ""}`}
      style={CARD}
      aria-label={title}
    >
      <h2 className="text-[14px] font-bold text-ink-strong">{title}</h2>
      {empty ? (
        <p className="mt-3 rounded-lg bg-[#F8FAFD] px-3 py-6 text-center text-[13px] text-ink-muted">
          {note ?? NOT_CONNECTED_MESSAGE}
        </p>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </section>
  );
}
