import { requireAdmin } from "@/lib/auth/current";
import { getPeriodPayout, currentPeriodIST } from "@/lib/queries/incentives";
import { getPeriodLedgerByEmployee } from "@/lib/queries/incentive-admin";

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Bank-/payroll-ready CSV of a period's incentive payout, one line per employee. */
export async function GET(req: Request) {
  await requireAdmin();
  const period = new URL(req.url).searchParams.get("period") ?? currentPeriodIST();
  const [payout, byEmp] = await Promise.all([getPeriodPayout(period), getPeriodLedgerByEmployee(period)]);

  const header = ["Employee", "Line", "Category", "Amount (INR)", "Explanation"];
  const lines: (string | number)[][] = [];
  for (const r of payout.rows) {
    const empLines = byEmp[r.employeeId] ?? [];
    for (const l of empLines) lines.push([r.employeeName, l.lineCode, l.category, (l.amountPaise / 100).toFixed(2), l.explanation ?? ""]);
    lines.push([r.employeeName, "TOTAL", "", (r.totalPaise / 100).toFixed(2), ""]);
  }
  lines.push(["GRAND TOTAL", "", "", (payout.grandTotalPaise / 100).toFixed(2), `${period} · status ${payout.status}`]);

  const csv = [header, ...lines].map((row) => row.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="incentive-payout-${period}.csv"`,
    },
  });
}
