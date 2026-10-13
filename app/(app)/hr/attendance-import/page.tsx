import { DashboardHeader } from "@/components/layout/header";
import { AttendanceImportShell } from "@/components/hr/attendance-import-shell";
import { requireAdmin } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

/**
 * Attendance CSV Bulk Upload — layout only. The page reads no file and touches
 * no attendance, leave or payroll data; see AttendanceImportShell.
 */
export default async function AttendanceImportPage() {
  await requireAdmin();

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <div style={{ background: "#F7F6F3" }}>
        <main className="mx-auto max-w-[1180px] px-8 max-md:px-4 pt-6 pb-10 max-md:pb-8 grid gap-6">
          <header>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">
              HR · Attendance
            </div>
            <h1 className="mt-1 text-[26px] font-bold text-ink-strong">Attendance CSV Bulk Upload</h1>
            <p className="mt-1 text-[14px] text-ink-muted max-w-3xl">
              Load attendance for many employees at once from a CSV file.
            </p>
          </header>
          <AttendanceImportShell />
        </main>
      </div>
    </>
  );
}
