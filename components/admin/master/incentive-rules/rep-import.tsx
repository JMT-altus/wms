"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import { importRepresentativePeriods } from "@/app/(masters)/master-setup/incentive-rules/calculation/input-actions";
import { BLUE, BTN, BTN_PLAIN, CARD, day } from "./calc-ui";

interface Row {
  line: number;
  customer: string;
  employee: string;
  from: string;
  to: string | null;
  customerName: string | null;
  employeeName: string | null;
  problem: string | null;
}

/**
 * Representatives → Import a file. A CSV with the columns customer, employee, from, to, note (customer = the Customer
 * Master's code or exact name, employee = the employee's email, dates yyyy-mm-dd, a blank "to" = still current). "Check
 * the file" records nothing and lists every row with what it maps to or its problem; "Import" records the periods only
 * when every row is right, all together (each with its history, exactly as one recorded by hand), or nothing.
 */
export function RepImport() {
  const router = useRouter();
  const [csv, setCsv] = React.useState("");
  const [name, setName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const bad = rows?.filter((r) => r.problem).length ?? 0;
  const run = async (commit: boolean) => {
    setBusy(true);
    setError(null);
    const r = await importRepresentativePeriods({ csv, commit });
    setBusy(false);
    if (!r.ok) {
      setRows(null);
      return setError(r.error);
    }
    setRows(r.rows);
    if (commit && r.imported) {
      fireToast({ message: `Imported ${r.imported} representative period${r.imported === 1 ? "" : "s"}.`, type: "success" });
      setCsv("");
      setName(null);
      setRows(null);
      router.refresh();
    }
  };
  return (
    <section aria-label="Import representative periods" className="mb-4 rounded-section bg-white p-4 text-[12.5px]" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Import representative periods</h2>
      <p className="mt-0.5 text-ink-muted">
        A CSV file with the columns <code>customer, employee, from, to, note</code>: the customer&apos;s Customer Master code (or exact name), the representative&apos;s email, the dates as yyyy-mm-dd (a blank &quot;to&quot; = still current). Check the file first: nothing is recorded unless every row is right, and then all of them are, together.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Representative periods file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setRows(null);
            setError(null);
            if (!f) return;
            if (f.size > 2_000_000) return setError("The file is larger than 2 MB.");
            setName(f.name);
            setCsv(await f.text());
          }}
        />
        <button type="button" className={BTN_PLAIN} disabled={busy || !csv} onClick={() => run(false)}>
          Check the file
        </button>
        <button type="button" className={BTN} style={{ background: BLUE }} disabled={busy || !rows || bad > 0 || !csv} onClick={() => run(true)}>
          Import {rows && !bad ? `${rows.length} period${rows.length === 1 ? "" : "s"}` : ""}
        </button>
        {name && <span className="text-ink-muted">{name}</span>}
      </div>
      {error && (
        <p role="alert" className="mt-2 font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}
      {rows && (
        <div className="mt-2">
          <p className={bad ? "font-semibold text-[#B91C1C]" : "font-semibold text-[#15803d]"}>{bad ? `${bad} of ${rows.length} row${rows.length === 1 ? "" : "s"} can't be imported: correct the file and check it again. Nothing was recorded.` : `All ${rows.length} row${rows.length === 1 ? "" : "s"} are right. Nothing is recorded until you import.`}</p>
          <table className="mt-2 w-full text-left" aria-label="Rows of the file">
            <thead>
              <tr className="text-ink-subtle">
                {["Line", "Customer", "Representative", "From", "To", "Check"].map((h) => (
                  <th key={h} className="px-2 py-1 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} className="border-t" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
                  <td className="px-2 py-1 tabular-nums">{r.line}</td>
                  <td className="px-2 py-1">{r.customerName ?? r.customer}</td>
                  <td className="px-2 py-1">{r.employeeName ?? r.employee}</td>
                  <td className="px-2 py-1">{day(r.from)}</td>
                  <td className="px-2 py-1">{r.to ? day(r.to) : "Current"}</td>
                  <td className={`px-2 py-1 ${r.problem ? "font-semibold text-[#B91C1C]" : "text-[#15803d]"}`}>{r.problem ?? "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
