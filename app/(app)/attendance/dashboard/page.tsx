import { FileSpreadsheet, FileText } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { requireAdmin } from "@/lib/auth/current";
import { getMonthDashboard } from "@/lib/queries/attendance-status";
import { localDateString } from "@/lib/format";
import { AttendanceDashboardTable } from "@/components/attendance/dashboard/dashboard-table";
import { AttendanceMonthSelector } from "@/components/attendance/dashboard/month-selector";

export const dynamic = "force-dynamic";

/** Default reporting timezone — "today" for the live-row grading. The
 *  per-employee query still reads each employee's own tz internally. */
const DEFAULT_TZ = "Asia/Kolkata";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Parse `?y=&m=`; fall back to the current month in the reporting tz. */
function resolveMonth(
  sp: Record<string, string | string[] | undefined>,
  todayISO: string,
): { year: number; month: number } {
  const [cy, cm] = todayISO.split("-").map(Number);
  const rawY = typeof sp.y === "string" ? Number(sp.y) : NaN;
  const rawM = typeof sp.m === "string" ? Number(sp.m) : NaN;
  const year =
    Number.isInteger(rawY) && rawY >= 2000 && rawY <= 2100 ? rawY : (cy ?? 2026);
  const month =
    Number.isInteger(rawM) && rawM >= 1 && rawM <= 12 ? rawM : (cm ?? 1);
  return { year, month };
}

export default async function AttendanceDashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  await requireAdmin();

  const todayISO = localDateString(DEFAULT_TZ);
  const { year, month } = resolveMonth(sp, todayISO);

  let rows: Awaited<ReturnType<typeof getMonthDashboard>>;
  let loadError = false;
  try {
    rows = await getMonthDashboard(year, month, todayISO);
  } catch (err) {
    console.error("[attendance/dashboard] load failed", err);
    rows = [];
    loadError = true;
  }

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto w-full max-w-[1480px] px-10 max-lg:px-6 max-md:px-4 pt-6 pb-12">
        <header className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#0B4FB8]">Admin · Attendance</p>
          <h1 className="mt-0.5 text-[#0B1F44]">Attendance Dashboard</h1>
          <p className="mt-1 text-[13.5px] text-[#5B6B85]">Monthly per-person summary. Click a row to see the daily log.</p>
        </header>

        {/* One toolbar: the month on the left, the month-scoped actions on the right. */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[#DCE4F0] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(11,31,68,0.05)]">
          <AttendanceMonthSelector year={year} month={month} />
          <div className="flex flex-wrap items-center gap-2">
            {/* Task A7 — month-scoped report exports. Plain links: the routes
                respond with an attachment Content-Disposition. */}
            <a href={`/attendance/export.xlsx?y=${year}&m=${month}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D6DEEB] bg-white px-3 text-[13px] font-semibold text-[#0B1F44] shadow-[0_1px_2px_rgba(11,31,68,0.05)] transition-colors hover:border-[#0A6CFF] hover:text-[#0B4FB8] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20">
              <FileSpreadsheet size={14} strokeWidth={2.2} className="text-[#0A6CFF]" />
              Export Excel
            </a>
            <a href={`/attendance/export.pdf?y=${year}&m=${month}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D6DEEB] bg-white px-3 text-[13px] font-semibold text-[#0B1F44] shadow-[0_1px_2px_rgba(11,31,68,0.05)] transition-colors hover:border-[#0A6CFF] hover:text-[#0B4FB8] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20">
              <FileText size={14} strokeWidth={2.2} className="text-[#0A6CFF]" />
              Export PDF
            </a>
            <button
              type="button"
              disabled
              title="Coming in Phase 2"
              className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed border-[#D6DEEB] bg-[#F5F7FB] px-3 text-[13px] font-semibold text-[#94A3B8]"
            >
              Generate Salary
              <span className="rounded bg-[#E2E8F0] px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-[#64748B]">Phase 2</span>
            </button>
          </div>
        </div>

        {loadError ? (
          <div
            className="rounded-section bg-surface-card border border-hairline p-10 text-center"
            style={{ boxShadow: "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" }}
          >
            <p className="font-bold text-ink-strong" style={{ fontSize: 18 }}>
              Could not load the attendance dashboard.
            </p>
            <p className="mt-2 font-semibold text-ink-muted" style={{ fontSize: 15 }}>
              Please refresh in a moment.
            </p>
          </div>
        ) : (
          <AttendanceDashboardTable rows={rows} year={year} month={month} />
        )}
      </main>
    </>
  );
}
