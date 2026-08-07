import { AlertTriangle } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { listEmployeeOptions } from "@/lib/queries/employees";
import {
  daysSinceLastSession,
  getTrainingSettings,
  listPastSessions,
  listUpcomingSessions,
} from "@/lib/queries/training";
import { db } from "@/lib/db";
import { trainingSessionAttendance } from "@/db/schema";
import { eq } from "drizzle-orm";
import { CalendarPanel } from "@/components/training/calendar-panel";
import { PageHead } from "@/components/training/ui";

export const dynamic = "force-dynamic";

export default async function TrainingCalendarPage() {
  const me = await requireUser();
  const [upcoming, past, employees, sinceLast, settings] = await Promise.all([
    listUpcomingSessions(),
    listPastSessions(),
    listEmployeeOptions(),
    daysSinceLastSession(),
    getTrainingSettings(),
  ]);

  // Attendance for every session on the page, in one round-trip.
  const attRows = await db
    .select({
      sessionId: trainingSessionAttendance.sessionId,
      employeeId: trainingSessionAttendance.employeeId,
    })
    .from(trainingSessionAttendance)
    .where(eq(trainingSessionAttendance.present, true));
  const attendanceBySession: Record<string, string[]> = {};
  for (const r of attRows) {
    (attendanceBySession[r.sessionId] ??= []).push(r.employeeId);
  }

  const overdue = sinceLast === null || sinceLast > settings.cadenceDays;

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1300px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="TRAINING CALENDAR"
          title="Training Calendar"
          sub="Schedule sessions, mark attendance and gather feedback."
        />

        {overdue && (
          <div
            className="mb-5 flex items-start gap-3 rounded-chip px-5 py-4"
            style={{
              background: "color-mix(in srgb, var(--color-amber) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-amber) 32%, transparent)",
            }}
          >
            <AlertTriangle
              size={19}
              strokeWidth={2.4}
              style={{ color: "var(--color-amber-deep)", flexShrink: 0, marginTop: 1 }}
            />
            <div>
              <p className="font-bold" style={{ fontSize: 15, color: "var(--color-amber-deep)" }}>
                {sinceLast === null
                  ? "No training has been held yet."
                  : `Last session was ${sinceLast} days ago.`}
              </p>
              <p
                className="mt-0.5 font-semibold"
                style={{ fontSize: 13.5, color: "var(--color-amber-deep)", opacity: 0.85 }}
              >
                Aim for a session at least every {settings.cadenceDays} days.
                {me.isAdmin ? " Schedule one below." : ""}
              </p>
            </div>
          </div>
        )}

        <CalendarPanel
          upcoming={upcoming}
          past={past}
          employees={employees}
          attendanceBySession={attendanceBySession}
          canCurate={me.isAdmin}
        />
      </main>
      <DashboardFooter />
    </>
  );
}
