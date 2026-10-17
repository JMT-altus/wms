import { asc, eq } from "drizzle-orm";
import { DashboardHeader } from "@/components/layout/header";
import { AttendanceImportShell } from "@/components/hr/attendance-import-shell";
import { AttendanceImportHistory } from "@/components/hr/attendance-import-history";
import { listImportBatches } from "./actions";
import { requireAdmin } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { employees } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * HR → Attendance Import. Admin only (enforced again in the server actions).
 * The page only supplies the active employees the admin can map people to.
 */
export default async function AttendanceImportPage() {
  await requireAdmin();
  const people = await db
    .select({ id: employees.id, name: employees.name, email: employees.email })
    .from(employees)
    .where(eq(employees.isActive, true))
    .orderBy(asc(employees.name));

  const history = await listImportBatches();

  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="HR · Attendance Import" />
      <div style={{ background: "#F6F8FC" }}>
        <main className="mx-auto max-w-[1180px] px-8 max-md:px-4 pt-5 pb-10 max-md:pb-8 grid grid-cols-[minmax(0,1fr)] gap-4">
          <header>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">HR · Attendance</div>
            <h1 className="mt-1 text-[24px] font-bold text-ink-strong">Attendance Bulk Upload</h1>
            <p className="mt-1 text-[13.5px] text-ink-muted max-w-3xl">
              Load in and out times for many employees from the biometric report. Existing punches are never overwritten.
            </p>
          </header>
          <AttendanceImportShell people={people} />
          <AttendanceImportHistory batches={history.ok ? history.batches : []} />
        </main>
      </div>
    </>
  );
}
