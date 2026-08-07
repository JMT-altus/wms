"use client";
import * as React from "react";
import { CalendarPlus, Clock, MapPin, Trash2, UserCheck, Users, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { SessionRow } from "@/lib/queries/training";
import {
  cancelSession,
  createSession,
  deleteSession,
  setAttendance,
} from "@/app/(app)/training/actions";
import { EmptyState, Panel, Stars, TRAINING_ACCENT, TRAINING_ACCENT_SOFT } from "./ui";

export interface EmployeeOption {
  id: string;
  name: string;
}

export function CalendarPanel({
  upcoming,
  past,
  employees,
  attendanceBySession,
  canCurate,
}: {
  upcoming: SessionRow[];
  past: SessionRow[];
  employees: EmployeeOption[];
  /** sessionId -> employeeIds marked present. */
  attendanceBySession: Record<string, string[]>;
  canCurate: boolean;
}) {
  const [scheduling, setScheduling] = React.useState(false);

  return (
    <div className="grid gap-5">
      {canCurate && (
        <div className="flex justify-end">
          {scheduling ? null : (
            <button
              type="button"
              onClick={() => setScheduling(true)}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-white font-bold transition-transform hover:-translate-y-0.5"
              style={{
                fontSize: 15,
                background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
                boxShadow: "0 10px 22px -10px rgba(11,124,138,0.6)",
              }}
            >
              <CalendarPlus size={17} strokeWidth={2.4} />
              Schedule training
            </button>
          )}
        </div>
      )}

      {scheduling && (
        <ScheduleForm employees={employees} onClose={() => setScheduling(false)} />
      )}

      <section>
        <h2
          className="uppercase font-bold tracking-[0.14em] text-ink-subtle mb-3"
          style={{ fontSize: 11.5 }}
        >
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState title="No upcoming sessions scheduled." />
        ) : (
          <div className="grid gap-3">
            {upcoming.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                employees={employees}
                present={attendanceBySession[s.id] ?? []}
                canCurate={canCurate}
                upcoming
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2
          className="uppercase font-bold tracking-[0.14em] text-ink-subtle mb-3"
          style={{ fontSize: 11.5 }}
        >
          Past sessions
        </h2>
        {past.length === 0 ? (
          <EmptyState title="No sessions held yet." />
        ) : (
          <div className="grid gap-3">
            {past.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                employees={employees}
                present={attendanceBySession[s.id] ?? []}
                canCurate={canCurate}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SessionCard({
  session,
  employees,
  present,
  canCurate,
  upcoming = false,
}: {
  session: SessionRow;
  employees: EmployeeOption[];
  present: string[];
  canCurate: boolean;
  upcoming?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const presentSet = React.useMemo(() => new Set(present), [present]);

  const when = session.scheduledAt.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(msg);
      else toast.error(res.error ?? "That didn't work.");
    });
  }

  return (
    <Panel className={session.cancelled ? "opacity-60" : ""}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
            {session.title}
            {session.cancelled && (
              <span
                className="ml-2 font-bold"
                style={{ fontSize: 12.5, color: "var(--color-red-deep)" }}
              >
                CANCELLED
              </span>
            )}
          </p>
          <p
            className="mt-1.5 flex items-center gap-3 flex-wrap text-ink-muted"
            style={{ fontSize: 13.5 }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Clock size={14} strokeWidth={2.3} /> {when} · {session.durationMin} min
            </span>
            {session.trainerName && (
              <span className="inline-flex items-center gap-1.5">
                <UserCheck size={14} strokeWidth={2.3} /> {session.trainerName}
              </span>
            )}
            {session.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} strokeWidth={2.3} /> {session.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Users size={14} strokeWidth={2.3} /> {session.attendeeCount} attended
            </span>
            {!upcoming && <Stars value={session.avgRating} size={13} />}
          </p>
          {session.notes && (
            <p className="mt-2 text-ink-muted" style={{ fontSize: 13.5 }}>
              {session.notes}
            </p>
          )}
        </div>

        {canCurate && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-xl px-3.5 py-2 font-bold text-ink-soft"
              style={{ fontSize: 13.5, border: "1px solid var(--color-hairline)" }}
            >
              {open ? "Hide" : "Attendance"}
            </button>
            <button
              type="button"
              title={session.cancelled ? "Restore" : "Cancel"}
              disabled={pending}
              onClick={() =>
                run(
                  () => cancelSession(session.id, !session.cancelled),
                  session.cancelled ? "Restored" : "Cancelled",
                )
              }
              className="inline-flex items-center justify-center rounded-lg"
              style={{
                width: 34,
                height: 34,
                border: "1px solid var(--color-hairline)",
                color: "var(--color-amber-deep)",
              }}
            >
              <XCircle size={16} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              title="Delete"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete "${session.title}"?`)) return;
                run(() => deleteSession(session.id), "Deleted");
              }}
              className="inline-flex items-center justify-center rounded-lg"
              style={{
                width: 34,
                height: 34,
                border: "1px solid var(--color-hairline)",
                color: "var(--color-red-deep)",
              }}
            >
              <Trash2 size={16} strokeWidth={2.2} />
            </button>
          </div>
        )}
      </div>

      {open && canCurate && (
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-hairline)" }}>
          <p
            className="uppercase font-bold tracking-[0.08em] text-ink-subtle mb-2.5"
            style={{ fontSize: 11.5 }}
          >
            Who attended — only attendees can rate this session
          </p>
          <div className="grid grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-2">
            {employees.map((e) => {
              const on = presentSet.has(e.id);
              return (
                <label
                  key={e.id}
                  className="inline-flex items-center gap-2.5 rounded-chip px-3 py-2 cursor-pointer bg-surface-soft"
                  style={{ border: "1px solid var(--color-hairline)" }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={pending}
                    onChange={() =>
                      run(() => setAttendance(session.id, e.id, !on), "Attendance saved")
                    }
                    className="size-4"
                  />
                  <span className="font-semibold text-ink-soft truncate" style={{ fontSize: 14 }}>
                    {e.name}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

function ScheduleForm({
  employees,
  onClose,
}: {
  employees: EmployeeOption[];
  onClose: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [durationMin, setDurationMin] = React.useState(60);
  const [trainerId, setTrainerId] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createSession({
        title,
        scheduledAt,
        durationMin,
        trainerId: trainerId || null,
        location,
        notes,
      });
      if (res.ok) {
        toast.success("Training scheduled");
        onClose();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          Schedule training
        </h3>
        <button type="button" onClick={onClose} aria-label="Close" className="text-ink-subtle">
          <X size={18} strokeWidth={2.4} />
        </button>
      </div>
      <form onSubmit={submit} className="grid gap-3.5">
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Back-office refresher"
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
            />
          </Field>
          <Field label="When">
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              required
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
            />
          </Field>
          <Field label="Duration (minutes)">
            <input
              type="number"
              min={5}
              max={600}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong tabular-nums"
            />
          </Field>
          <Field label="Trainer">
            <select
              value={trainerId}
              onChange={(e) => setTrainerId(e.target.value)}
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
            >
              <option value="">— pick someone —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location / link">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Office, or a Zoom link"
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
            />
          </Field>
          <Field label="Notes">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What it covers"
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 font-semibold text-ink-soft"
            style={{ fontSize: 14.5, border: "1px solid var(--color-hairline)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl px-5 py-2.5 text-white font-bold disabled:opacity-60"
            style={{
              fontSize: 14.5,
              background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
            }}
          >
            {pending ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block mb-1.5 uppercase font-bold tracking-[0.08em] text-ink-subtle"
        style={{ fontSize: 11.5 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
