import Link from "next/link";
import type { Route } from "next";
import { Card } from "@/components/forms/tally/ui";

/**
 * On a Forms Sales Order's page, for holders of an Incentive Calculation permission only: the salesperson(s) the
 * order is credited to for Category A. Read-only here — the record is kept in Incentive Rules → Order salespeople
 * (linked), never on the order itself, so the order's own data and behaviour don't change. Tally's import carries no
 * salesperson, so an order without a record says so plainly.
 */
export function SalesOrderSalespeople({ documentId, rows, canEdit }: { documentId: string; rows: { id: string; employeeName: string; sharePpm: number; active: boolean; retiredReason: string | null }[] | null; canEdit: boolean }) {
  const active = (rows ?? []).filter((r) => r.active);
  const retired = (rows ?? []).filter((r) => !r.active);
  const total = active.reduce((s, r) => s + r.sharePpm, 0);
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
          Incentive salesperson
        </h2>
        <Link href={`/master-setup/incentive-rules/calculation/salespeople?search=&order=${documentId}` as Route} className="ml-auto text-[12.5px] font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">
          {canEdit ? "Record or change" : "View in Order salespeople"}
        </Link>
      </div>
      {rows === null ? (
        <p className="mt-1 text-[13px] text-ink-muted">Not available until database updates 0132 and 0133 are applied.</p>
      ) : !active.length ? (
        <p className="mt-1 text-[13px] font-semibold text-amber-700">No salesperson recorded. Category A lists this order as needing one (when the configuration credits sales per order).</p>
      ) : (
        <ul className="mt-1 text-[13px]">
          {active.map((r) => (
            <li key={r.id}>
              <strong className="text-ink-strong">{r.employeeName}</strong> · {r.sharePpm / 10_000}%
            </li>
          ))}
          {total < 1_000_000 && <li className="font-semibold text-amber-700">Shares add up to {total / 10_000}%, not 100%.</li>}
        </ul>
      )}
      {!!retired.length && <p className="mt-1 text-[12px] text-ink-subtle">{retired.length} earlier record{retired.length === 1 ? "" : "s"} retired (kept in the history).</p>}
    </Card>
  );
}
