import { asc, eq } from "drizzle-orm";
import { DashboardHeader } from "@/components/layout/header";
import { AttendanceCorrectionPanel } from "@/components/hr/attendance-correction-panel";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { db } from "@/lib/db";
import { employees } from "@/db/schema";
import { localDateString } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * HR → Attendance Correction. HR module access only (admins, or anyone granted
 * HR) — checked here for the page and again in every server action.
 */
export default async function AttendanceCorrectionPage() {
  await requireModuleAccess("hr");
  const people = await db
    .select({ id: employees.id, name: employees.name, email: employees.email })
    .from(employees)
    .where(eq(employees.isActive, true))
    .orderBy(asc(employees.name));

  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="HR · Attendance Correction" />
      <div style={{ background: "#F6F8FC" }}>
        <main className="mx-auto max-w-[980px] px-8 max-md:px-4 pt-5 pb-10 max-md:pb-8 grid grid-cols-[minmax(0,1fr)] gap-4">
          <header>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">HR · Attendance</div>
            <h1 className="mt-1 text-[24px] font-bold text-ink-strong">Attendance Correction</h1>
            <p className="mt-1 text-[13.5px] text-ink-muted max-w-3xl">
              Enter or correct IN / OUT times when a power failure or biometric outage meant they were not recorded. Every
              correction needs a reason and an explanation, and is kept in the audit history with the previous times.
            </p>
          </header>
          <AttendanceCorrectionPanel people={people} today={localDateString("Asia/Kolkata")} />
        </main>
      </div>
    </>
  );
}
