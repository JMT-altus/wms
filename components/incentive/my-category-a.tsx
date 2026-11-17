import type { MyCategoryAMonth } from "@/lib/queries/incentive-calc";
import type { IncentiveLine } from "@/lib/queries/incentives";

/** Exact to the paisa: Category A amounts carry paise (e.g. ₹1,083.33), which the tracker's whole-rupee format would hide. */
const formatInrPaise = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * My Incentives → Category A, kept apart from everything else so nothing is ever added twice:
 *   · New Category A (authoritative) — the signed-in person's OWN amount for APPROVED or PAID months only; a month
 *     still being calculated or approved is named but never valued.
 *   · Historical Category A (old engine) — that engine's Category A lines for the month, unchanged, for reference.
 * Categories B–G stay in the old engine's sections of the page.
 */

const fmtMonth = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const fmtDay = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const CARD = { border: "1px solid rgba(15,23,42,0.08)", background: "#fff" } as const;

function Status({ m }: { m: MyCategoryAMonth }) {
  const paid = m.status === "paid";
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-[0.1em]" style={{ background: paid ? "rgba(34,181,99,0.14)" : "rgba(10,108,255,0.12)", color: paid ? "#15803d" : "#0a47b3" }}>
      {paid ? "PAID" : "APPROVED"}
    </span>
  );
}

export function MyCategoryA({ period, ready, months, awaiting, historical }: { period: string; ready: boolean; months: MyCategoryAMonth[]; awaiting: string[]; historical: IncentiveLine[] }) {
  const thisMonth = months.filter((m) => m.month.slice(0, 7) === period);
  const waiting = awaiting.some((m) => m.slice(0, 7) === period);
  const histTotal = historical.reduce((s, l) => s + l.amountPaise, 0);
  return (
    <section className="mb-7" aria-label="Category A">
      <h2 className="text-display-xs text-ink-strong mb-3">Category A · Sales Order Received</h2>
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        <div className="rounded-[18px] p-5" style={CARD} aria-label="New Category A">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold tracking-[0.14em] rounded-full px-2 py-0.5" style={{ background: "rgba(10,108,255,0.10)", color: "#0a47b3" }}>
              NEW · AUTHORITATIVE
            </span>
            <span className="text-ink-subtle text-[12.5px] font-semibold">{fmtMonth(period)}</span>
          </div>
          {!ready ? (
            <p className="mt-3 text-[13.5px] text-ink-muted">Not available yet.</p>
          ) : thisMonth.length ? (
            thisMonth.map((m) => (
              <div key={`${m.programCode}-${m.month}`} className="mt-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-extrabold text-ink-strong" style={{ fontSize: 30, fontVariantNumeric: "tabular-nums" }}>
                    {formatInrPaise(m.amountPaise)}
                  </span>
                  <Status m={m} />
                </div>
                <p className="mt-1 text-[12.5px] text-ink-muted">
                  {m.programName} · {m.status === "paid" ? `paid ${fmtDay(m.paidOn)}${m.payoutReference ? ` · ref ${m.payoutReference}` : ""}` : `approved · released ${fmtDay(m.releaseOn)}`}
                </p>
                {!!m.explanation.length && (
                  <details className="mt-2 text-[12.5px] text-ink-muted">
                    <summary className="cursor-pointer font-semibold">How it was worked out</summary>
                    <ul className="mt-1 list-disc pl-4">
                      {m.explanation.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))
          ) : (
            <p className="mt-3 text-[13.5px] text-ink-muted">{waiting ? "Calculated and awaiting approval — your amount appears here once it is approved." : "No approved Category A for this month."}</p>
          )}
        </div>
        <div className="rounded-[18px] p-5" style={CARD} aria-label="Historical Category A">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold tracking-[0.14em] rounded-full px-2 py-0.5" style={{ background: "rgba(15,23,42,0.06)", color: "#475569" }}>
              HISTORICAL · OLD ENGINE
            </span>
            <span className="text-ink-subtle text-[12.5px] font-semibold">{fmtMonth(period)}</span>
          </div>
          {historical.length ? (
            <>
              <div className="mt-3 font-bold text-ink-strong" style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>
                {formatInrPaise(histTotal)}
              </div>
              <ul className="mt-1 grid gap-1 text-[12.5px] text-ink-muted">
                {historical.map((l, i) => (
                  <li key={`${l.lineCode}-${i}`}>
                    <strong className="text-ink-strong">{l.lineCode}</strong> {formatInrPaise(l.amountPaise)} — {l.explanation}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11.5px] text-ink-subtle">Kept as recorded by the old engine, for reference. Not added to the new Category A.</p>
            </>
          ) : (
            <p className="mt-3 text-[13.5px] text-ink-muted">None for this month.</p>
          )}
        </div>
      </div>
      {ready && months.length > 0 && (
        <div className="mt-4 rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          <table className="w-full text-[13px]" aria-label="Category A history">
            <thead>
              <tr className="text-left text-ink-subtle" style={{ background: "rgba(15,23,42,0.02)" }}>
                {["Month", "Programme", "Amount", "Status", "Released / paid"].map((h) => (
                  <th key={h} className="px-4 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={`${m.programCode}-${m.month}`} className="border-t" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
                  <td className="px-4 py-2 font-semibold text-ink-strong">{fmtMonth(m.month)}</td>
                  <td className="px-4 py-2">{m.programName}</td>
                  <td className="px-4 py-2 font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatInrPaise(m.amountPaise)}
                  </td>
                  <td className="px-4 py-2">
                    <Status m={m} />
                  </td>
                  <td className="px-4 py-2 text-ink-muted">{m.status === "paid" ? `${fmtDay(m.paidOn)}${m.payoutReference ? ` · ${m.payoutReference}` : ""}` : fmtDay(m.releaseOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
