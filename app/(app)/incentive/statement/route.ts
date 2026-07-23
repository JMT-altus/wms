import { requireUser } from "@/lib/auth/current";
import { getIncentiveSummary, currentPeriodIST } from "@/lib/queries/incentives";

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The signed-in rep's own incentive statement for a period, as CSV. */
export async function GET(req: Request) {
  const me = await requireUser();
  const period = new URL(req.url).searchParams.get("period") ?? currentPeriodIST();
  const summary = await getIncentiveSummary(me.id, period);

  const header = ["Line", "Category", "Amount (INR)", "Explanation"];
  const rows = summary.lines.map((l) => [l.lineCode, l.category, (l.amountPaise / 100).toFixed(2), l.explanation ?? ""]);
  rows.push(["TOTAL", "", (summary.totalPaise / 100).toFixed(2), `${me.name} · ${period} · ${summary.status}`]);

  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="incentive-statement-${period}.csv"`,
    },
  });
}
