"use client";

import { CARD, rs } from "./calc-ui";

/**
 * Categories C–G: each credited item of the month's calculation — a new customer, a customer's run of purchases, an
 * approved lead batch, conversion, meeting or testimonial — with its salesperson, what it earned and why, and every
 * item that wasn't credited with the reason. Read-only.
 */

export interface XItemRow {
  id: string;
  employeeName: string | null;
  lineCode: string;
  label: string;
  baseExact: string;
  earnedExact: string;
  payableExact: string;
  multiplierPpm: number | null;
  status: "credited" | "pending";
  explanation: string[];
}

const paise = (x: string) => {
  const [n, d] = x.split("/");
  return Math.round(Number(n) / Number(d ?? "1"));
};

export function XItems({ items, excluded }: { items: XItemRow[]; excluded: { documentNo: string | null; message: string }[] }) {
  return (
    <section aria-label="Items" className="rounded-section bg-white p-4" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Items credited ({items.length})</h2>
      {!items.length ? (
        <p className="mt-1 text-[12.5px] text-ink-subtle">Nothing credited this month.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12.5px]" style={{ minWidth: 760 }} aria-label="Credited items">
            <thead>
              <tr className="text-left text-ink-subtle">
                {["Line", "Item", "Salesperson", "Amount", "Earned", "Payable", "Why"].map((h) => (
                  <th key={h} className="px-2 py-1 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-hairline align-top">
                  <td className="px-2 py-1.5 font-semibold text-ink-strong">{i.lineCode}</td>
                  <td className="px-2 py-1.5">{i.label}</td>
                  <td className="px-2 py-1.5">{i.employeeName ?? "—"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{rs(paise(i.baseExact))}</td>
                  <td className="px-2 py-1.5 tabular-nums">{rs(paise(i.earnedExact))}</td>
                  <td className="px-2 py-1.5 font-semibold tabular-nums">{i.status === "pending" ? <span className="text-[#B45309]">Not yet payable</span> : rs(paise(i.payableExact))}</td>
                  <td className="px-2 py-1.5 text-ink-muted">{i.explanation.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!excluded.length && (
        <details className="mt-3 text-[12.5px]">
          <summary className="cursor-pointer font-semibold text-ink-strong">Not credited ({excluded.length})</summary>
          <ul className="mt-1 grid gap-0.5 text-ink-muted" aria-label="Not credited">
            {excluded.map((x, k) => (
              <li key={k}>
                {x.documentNo ? <strong className="text-ink-strong">{x.documentNo}: </strong> : null}
                {x.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
