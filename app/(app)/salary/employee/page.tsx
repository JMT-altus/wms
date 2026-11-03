import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireAdmin } from "@/lib/auth/current";
import { localDateString } from "@/lib/format";
import { listReportEmployees } from "@/lib/salary/employee-report";
import { EmployeeReportPicker } from "@/components/salary/admin/employee-report-picker";
import { CARD, NAVY, PAGE_GROUND, SLATE } from "@/components/attendance/overview/theme";

export const dynamic = "force-dynamic";

/**
 * Employee Salary Report — the admin's starting point: choose an employee to
 * open their salary report. Same access as the Salary page (requireAdmin).
 */
export default async function EmployeeSalaryReportIndex() {
  await requireAdmin();
  const month = localDateString("Asia/Kolkata").slice(0, 7);
  const people = await listReportEmployees();
  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="Employees ▸ Salary ▸ Employee report" fullWidth />
      <div style={{ background: PAGE_GROUND }}>
        <main className="w-full px-6 pt-5 pb-10 max-md:px-4 lg:px-8 grid grid-cols-[minmax(0,1fr)] gap-5">
          <section className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-2xl px-6 py-5 max-md:px-4" style={CARD} aria-labelledby="emp-report-title">
            <div className="min-w-0">
              <Link href={"/salary" as Route} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: SLATE }}>
                <ArrowLeft size={13} aria-hidden /> Salary
              </Link>
              <h1 id="emp-report-title" className="mt-1 text-[clamp(26px,2.6vw,32px)] font-extrabold leading-none tracking-[-0.02em]" style={{ color: NAVY }}>
                Employee Salary Report
              </h1>
              <p className="mt-1 text-[14.5px] font-medium" style={{ color: SLATE }}>
                Choose an employee to see their pay, deductions and day-by-day attendance for a month.
              </p>
            </div>
            <EmployeeReportPicker employees={people} selectedId={null} month={month} />
          </section>
        </main>
      </div>
      <div className="[&>footer]:mt-0">
        <DashboardFooter />
      </div>
    </>
  );
}
