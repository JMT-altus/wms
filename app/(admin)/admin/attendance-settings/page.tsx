import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { ShieldAlert } from "lucide-react";
import { requireAdmin } from "@/lib/auth/current";
import { canManageAttendanceSettings } from "@/lib/auth/attendance-settings";
import { db } from "@/lib/db";
import { departments, employees } from "@/db/schema";
import { localDateString } from "@/lib/format";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { listPolicyChanges, listPolicyHistory } from "@/lib/queries/attendance-policy";
import { companyDefaults, minShiftEffectiveDate } from "@/lib/queries/attendance-schedule";
import { describeShiftValue, isShiftKey, resolveShiftSettings, SHIFT_KEY_LABEL, type ShiftKey, type ShiftSettings } from "@/lib/attendance/shift-settings";
import { AttendanceSettingsPanel } from "@/components/admin/attendance-settings";

export const dynamic = "force-dynamic";

/**
 * Admin Panel → Attendance Settings: work shifts, check-in grace, check-out grace.
 *
 * Open to admins who are super-admins or hold the sensitive
 * `attendance.settings.manage` permission (checked here and again in every
 * action). Values are effective-dated rows in the attendance policy table, read
 * by every attendance calculation through lib/queries/attendance-schedule.ts.
 */
export default async function AttendanceSettingsPage() {
  const me = await requireAdmin();
  const header = (
    <header className="mb-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">Admin · Attendance</div>
      <h1 className="mt-1 text-[28px] font-bold text-ink-strong">Attendance Settings</h1>
      <p className="mt-1 max-w-3xl text-[14px] text-ink-muted">
        Work shifts and the check-in / check-out grace periods. Attendance reads them for every day from their effective date;
        earlier days keep the rules that applied to them.
      </p>
    </header>
  );

  if (!(await canManageAttendanceSettings(me))) {
    return (
      <div className="max-w-[1080px]">
        {header}
        <section className="flex items-start gap-3 rounded-section bg-surface-card p-5" style={{ border: "1px solid var(--color-hairline)" }}>
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-[#B45309]" aria-hidden />
          <div>
            <h2 className="text-[15px] font-bold text-ink-strong">You don&rsquo;t have permission to manage attendance settings</h2>
            <p className="mt-1 text-[13.5px] text-ink-muted">
              A super-admin can grant &ldquo;Attendance settings — Manage shifts and grace periods&rdquo; in Admin &amp; Master Setup → Field Permissions.
            </p>
          </div>
        </section>
      </div>
    );
  }

  const today = localDateString("Asia/Kolkata");
  const [org, all, history, people, depts, overrides, min] = await Promise.all([
    getOrgSettings(),
    listPolicyChanges(),
    listPolicyHistory(100, "shifts"),
    db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.isActive, true)).orderBy(asc(employees.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name)),
    db
      .select({ name: employees.name, lateAfter: employees.attLateAfter, earlyBefore: employees.attEarlyBefore })
      .from(employees)
      .where(and(eq(employees.isActive, true), or(isNotNull(employees.attLateAfter), isNotNull(employees.attEarlyBefore))))
      .orderBy(asc(employees.name)),
    minShiftEffectiveDate(today),
  ]);
  const changes = all.filter((c) => isShiftKey(c.key));

  let current: ShiftSettings = { shifts: null, checkIn: null, checkOut: null, hoursHighlight: null };
  let readError: string | null = null;
  try {
    current = resolveShiftSettings(changes, today);
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }
  const upcoming = changes
    .filter((c) => c.effectiveFrom > today)
    .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? a.createdAt.getTime() - b.createdAt.getTime() : a.effectiveFrom < b.effectiveFrom ? -1 : 1))
    .map((c) => ({ label: SHIFT_KEY_LABEL[c.key as ShiftKey], effectiveFrom: c.effectiveFrom, summary: describeShiftValue(c.key, c.value) }));

  return (
    <div className="max-w-[1080px]">
      {header}
      <AttendanceSettingsPanel
        today={today}
        minDate={min.date}
        paidThrough={min.paidThrough}
        current={current}
        readError={readError}
        legacy={companyDefaults(org)}
        people={people}
        departments={depts}
        overrides={overrides}
        upcoming={upcoming}
        history={history.map((h) => ({
          id: h.id,
          label: isShiftKey(h.key) ? SHIFT_KEY_LABEL[h.key] : h.key,
          from: describeShiftValue(h.key, h.previousValue),
          to: describeShiftValue(h.key, h.value),
          effectiveFrom: h.effectiveFrom,
          reason: h.reason,
          by: h.changedByName,
          at: h.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
