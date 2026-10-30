"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink } from "lucide-react";
import { saveWeeklyUploadSettings } from "@/app/(masters)/master-setup/collection-weekly-upload/actions";
import type { WeeklyUploadOverview, WeeklyUploadWeekView } from "@/lib/queries/collection-weekly-upload";
import { STATE_LABEL, TRACKER_PATH, dowLabel, formatDueDay, weekLabel, type WeeklyTaskState } from "@/lib/collections/weekly-upload/week";

/**
 * The Weekly Bulk Upload settings and compliance view. Only the assignee and
 * the due weekday are editable; everything else is read from the database on
 * every load. The server validates the person again before saving.
 */

const CARD = "rounded-section border border-hairline bg-surface-card p-5";
const FIELD = "h-10 rounded-lg border border-hairline-strong bg-white px-3 text-[14px] text-ink-strong";
const DOWS = [1, 2, 3, 4, 5, 6, 7] as const;

const STATE_TONE: Record<WeeklyTaskState, { bg: string; fg: string }> = {
  pending: { bg: "#EEF4FF", fg: "#0B4FB8" },
  in_progress: { bg: "#EEF4FF", fg: "#0B4FB8" },
  completed: { bg: "#ECFDF5", fg: "#047857" },
  overdue: { bg: "#FEF2F2", fg: "#B91C1C" },
};

function StatePill({ state }: { state: WeeklyTaskState }) {
  const tone = STATE_TONE[state];
  return (
    <span className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11.5px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
      {state === "completed" ? <CheckCircle2 size={12} aria-hidden /> : state === "overdue" ? <AlertTriangle size={12} aria-hidden /> : <Clock3 size={12} aria-hidden />}
      {STATE_LABEL[state]}
    </span>
  );
}

const when = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export function WeeklyUploadManager({ overview, now }: { overview: WeeklyUploadOverview; now: string }) {
  const router = useRouter();
  const { settings, assignee, people } = overview;
  const [assigneeId, setAssigneeId] = React.useState<string>(settings.assigneeId ?? "");
  const [dueDow, setDueDow] = React.useState<number>(settings.dueDow);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  void now;

  const dirty = (settings.assigneeId ?? "") !== assigneeId || settings.dueDow !== dueDow;
  const chosen = people.find((p) => p.id === assigneeId);

  // What (if anything) stops the configured person from doing the upload.
  const assigneeWarning = !settings.storageReady
    ? null
    : !settings.assigneeId
      ? "No employee is responsible for the weekly Bulk Upload yet. Until one is chosen, no weekly task is created and nobody is reminded."
      : !assignee
        ? "The assigned employee no longer exists. Choose someone else."
        : !assignee.isActive
          ? `${assignee.name}'s account is deactivated. Choose someone else.`
          : !assignee.isAdmin
            ? `${assignee.name} is not an admin, so they cannot open the Collection Tracker. Choose someone else, or ask an admin to change their access.`
            : !assignee.holdsPermission
              ? `${assignee.name} does not hold the "Collection Tracker — Bulk Upload" permission, so they cannot upload. A super-admin grants it in Field Permissions; this page never grants it.`
              : null;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveWeeklyUploadSettings({ assigneeId: assigneeId || null, dueDow });
      if (!res.ok) setMsg({ ok: false, text: res.error });
      else {
        setMsg({
          ok: true,
          text: !res.changed
            ? "Nothing to change."
            : `Saved.${res.taskCreated ? " This week's task has been created." : ""}${res.reassigned > 0 ? ` ${res.reassigned} open task${res.reassigned === 1 ? "" : "s"} moved to the new person.` : ""}`,
        });
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: "The setting could not be saved, so nothing was changed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (!settings.storageReady) {
    return (
      <p role="status" className="rounded-lg border border-hairline bg-white px-4 py-3 text-[14px] text-ink-subtle">
        The weekly Bulk Upload task isn&apos;t set up on this database yet (database update 0121 is needed). Nothing can be configured until it is applied.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      {assigneeWarning && (
        <p role="alert" aria-label="Weekly upload setup" className="flex items-start gap-2 rounded-lg px-4 py-3 text-[13.5px] font-semibold" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {assigneeWarning}
        </p>
      )}

      <section aria-label="Responsible employee" className={CARD}>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-subtle">Who does the weekly upload?</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[12.5px] font-semibold text-ink-muted">
            Responsible employee
            <select aria-label="Responsible employee" className={FIELD} style={{ minWidth: 280 }} value={assigneeId} disabled={busy} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">— nobody (no weekly task) —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.holdsPermission ? "" : " — no Bulk Upload permission"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-ink-muted">
            Due every
            <select aria-label="Due weekday" className={FIELD} value={dueDow} disabled={busy} onChange={(e) => setDueDow(Number(e.target.value))}>
              {DOWS.map((d) => (
                <option key={d} value={d}>
                  {dowLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="inline-flex h-10 items-center rounded-lg px-4 text-[13.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--masters-accent, #b45309)" }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {chosen && !chosen.holdsPermission && (
          <p className="mt-2 text-[12.5px] font-semibold text-[#92400E]">
            {chosen.name} doesn&apos;t hold the &ldquo;Collection Tracker — Bulk Upload&rdquo; permission yet. Have a super-admin grant it in{" "}
            <Link href={"/master-setup/access-control" as Route} className="underline">
              Field Permissions
            </Link>{" "}
            first; this page can&apos;t save them until then.
          </p>
        )}
        <p className="mt-3 text-[12.5px] text-ink-muted">
          Only active admins are listed — the Collection Tracker is admin-only. The reporting week runs Monday to Sunday; the task is due on the chosen day at noon
          and counts as overdue from the next day. Changing the person moves the open week&apos;s task to them; completed weeks keep their history. Every change is
          recorded in the settings audit log.
        </p>
        {msg && (
          <p role="status" className={`mt-2 text-[13px] font-semibold ${msg.ok ? "text-[#047857]" : "text-[#B91C1C]"}`}>
            {msg.text}
          </p>
        )}
      </section>

      <section aria-label="This week" className={CARD}>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-subtle">This week</p>
        {overview.currentWeek ? (
          <WeekSummary week={overview.currentWeek} />
        ) : (
          <p className="text-[13.5px] text-ink-subtle">
            {settings.assigneeId
              ? "This week's task hasn't been created yet. The daily scheduler creates it; saving the setting above creates it at once."
              : "No task this week — nobody is responsible yet."}
          </p>
        )}
        <p className="mt-3 text-[12.5px] text-ink-muted">
          Last successful weekly upload:{" "}
          {overview.lastCompleted ? (
            <>
              <strong className="text-ink-strong">{when(overview.lastCompleted.completedAt)}</strong> for the week of {weekLabel(overview.lastCompleted.weekStart)}
              {overview.lastCompleted.completedFileName ? ` (${overview.lastCompleted.completedFileName})` : ""}
              {overview.lastCompleted.completedByName ? ` by ${overview.lastCompleted.completedByName}` : ""}.
            </>
          ) : (
            <strong className="text-ink-strong">none recorded yet</strong>
          )}
          {" · "}
          <Link href={TRACKER_PATH as Route} className="inline-flex items-center gap-1 font-bold" style={{ color: "#0A6CFF" }}>
            Open the Collection Tracker <ExternalLink size={12} aria-hidden />
          </Link>
        </p>
      </section>

      <section aria-label="Recent weeks" className="rounded-section border border-hairline bg-surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]" style={{ minWidth: 720 }}>
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
                <th className="px-4 py-3">Reporting week</th>
                <th className="px-4 py-3">Assigned to</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Task</th>
              </tr>
            </thead>
            <tbody>
              {overview.recent.length === 0 && (
                <tr className="border-t border-hairline">
                  <td colSpan={6} className="px-4 py-4 text-ink-subtle">
                    No weekly tasks yet.
                  </td>
                </tr>
              )}
              {overview.recent.map((w) => (
                <tr key={w.weekStart} className="border-t border-hairline">
                  <td className="px-4 py-2.5 font-semibold text-ink-strong">{weekLabel(w.weekStart)}</td>
                  <td className="px-4 py-2.5">{w.assigneeName ?? <span className="text-ink-subtle">Unassigned</span>}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatDueDay(new Date(w.dueAt))}</td>
                  <td className="px-4 py-2.5">
                    <StatePill state={w.state} />
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {w.completedAt ? (
                      <>
                        {when(w.completedAt)}
                        {w.completedByName ? <span className="text-ink-subtle"> · {w.completedByName}</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/tasks/${w.taskId}` as Route} className="font-bold" style={{ color: "#0A6CFF" }}>
                      Open task
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function WeekSummary({ week }: { week: WeeklyUploadWeekView }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-4">
      <div>
        <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Reporting week</dt>
        <dd className="font-semibold text-ink-strong">{weekLabel(week.weekStart)}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Assigned to</dt>
        <dd className="font-semibold text-ink-strong">{week.assigneeName ?? "Unassigned"}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Due</dt>
        <dd className="font-semibold text-ink-strong tabular-nums">{formatDueDay(new Date(week.dueAt))}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Status</dt>
        <dd>
          <StatePill state={week.state} />{" "}
          <Link href={`/tasks/${week.taskId}` as Route} className="ml-1 text-[12.5px] font-bold" style={{ color: "#0A6CFF" }}>
            Open task
          </Link>
        </dd>
      </div>
    </dl>
  );
}
