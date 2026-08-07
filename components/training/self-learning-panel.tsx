"use client";
import * as React from "react";
import { BookOpen, ExternalLink, MonitorPlay, Sparkles, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import {
  SELF_LEARNING_KINDS,
  SELF_LEARNING_KIND_LABELS,
  type SelfLearningKind,
} from "@/db/enums";
import type { SelfLearningMonth } from "@/lib/queries/training";
import { deleteSelfLearning, logSelfLearning } from "@/app/(app)/training/actions";
import { EmptyState, Panel, ProgressBar, TRAINING_ACCENT, TRAINING_ACCENT_SOFT } from "./ui";

const KIND_ICON: Record<SelfLearningKind, typeof BookOpen> = {
  book: BookOpen,
  video: Video,
  youtube: MonitorPlay,
  other: Sparkles,
};

function hrs(min: number): string {
  return (min / 60).toFixed(1);
}

export function SelfLearningPanel({
  month,
  todayYmd,
}: {
  month: SelfLearningMonth;
  /** Today's date in IST, computed server-side so the default never drifts. */
  todayYmd: string;
}) {
  const [kind, setKind] = React.useState<SelfLearningKind>("book");
  const [source, setSource] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(todayYmd);
  const [minutes, setMinutes] = React.useState(30);
  const [sourceLink, setSourceLink] = React.useState("");
  const [evidenceLink, setEvidenceLink] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const pct = month.targetMinutes > 0 ? (month.minutesLogged / month.targetMinutes) * 100 : 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await logSelfLearning({
        kind,
        source,
        entryDate,
        minutes,
        sourceLink,
        evidenceLink,
        notes,
      });
      if (res.ok) {
        toast.success("Learning logged");
        setSource("");
        setSourceLink("");
        setEvidenceLink("");
        setNotes("");
        setMinutes(30);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-5 items-start">
      <div className="grid gap-5">
        {/* Progress */}
        <Panel>
          <p
            className="uppercase font-bold tracking-[0.14em] text-ink-subtle"
            style={{ fontSize: 11.5 }}
          >
            {month.monthLabel}
          </p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span
              className="tabular-nums font-black leading-none"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontSize: 52,
                color: TRAINING_ACCENT,
              }}
            >
              {hrs(month.minutesLogged)}
            </span>
            <span className="font-bold text-ink-muted" style={{ fontSize: 18 }}>
              / {hrs(month.targetMinutes)} hrs
            </span>
          </div>
          <div className="mt-4">
            <ProgressBar pct={pct} />
          </div>
          <p className="mt-3 font-semibold text-ink-soft" style={{ fontSize: 14.5 }}>
            {month.remaining === 0
              ? "Target met for this month. 🎉"
              : `${hrs(month.remaining)} hrs to go this month.`}
          </p>
          <p className="mt-1 text-ink-subtle" style={{ fontSize: 13 }}>
            {month.minutesLogged} min logged · {month.entries.length}{" "}
            {month.entries.length === 1 ? "entry" : "entries"}
          </p>
        </Panel>

        {/* Form */}
        <Panel>
          <h2 className="font-bold text-ink-strong" style={{ fontSize: 18 }}>
            Log an entry
          </h2>
          <p className="mt-1 text-ink-muted" style={{ fontSize: 14 }}>
            Evidence (a link) is required — that&rsquo;s what makes it count.
          </p>

          <form onSubmit={submit} className="mt-4 grid gap-3.5">
            <div>
              <Label>Type</Label>
              <div className="flex gap-2 flex-wrap">
                {SELF_LEARNING_KINDS.map((k) => {
                  const Icon = KIND_ICON[k];
                  const active = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      aria-pressed={active}
                      className="inline-flex items-center gap-2 rounded-chip px-4 py-2.5 font-bold transition-colors"
                      style={
                        active
                          ? {
                              fontSize: 14.5,
                              background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
                              color: "#fff",
                              border: "1px solid transparent",
                            }
                          : {
                              fontSize: 14.5,
                              background: "var(--color-surface-soft)",
                              color: "var(--color-ink-soft)",
                              border: "1px solid var(--color-hairline)",
                            }
                      }
                    >
                      <Icon size={15} strokeWidth={2.3} />
                      {SELF_LEARNING_KIND_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
              <div>
                <Label>What did you learn from</Label>
                <Input
                  value={source}
                  onChange={setSource}
                  required
                  placeholder="e.g. Atomic Habits, ch. 3"
                />
              </div>
              <div>
                <Label>Date</Label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
                />
              </div>
              <div>
                <Label>Source link (optional)</Label>
                <Input value={sourceLink} onChange={setSourceLink} placeholder="https://…" />
              </div>
              <div>
                <Label>Minutes</Label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong tabular-nums"
                />
              </div>
            </div>

            <div>
              <Label>
                Evidence link ·{" "}
                <span style={{ color: "var(--color-red-deep)" }}>required</span>
              </Label>
              <Input
                value={evidenceLink}
                onChange={setEvidenceLink}
                required
                placeholder="A photo, notes doc, or proof link (https://…)"
              />
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Key takeaway or how you'll apply it"
                className="w-full rounded-chip px-3.5 py-2.5 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong resize-y"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="justify-self-end inline-flex items-center gap-2 rounded-xl px-6 py-3 text-white font-bold disabled:opacity-60"
              style={{
                fontSize: 15,
                background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
                boxShadow: "0 10px 22px -10px rgba(11,124,138,0.6)",
              }}
            >
              {pending ? "Saving…" : "＋ Log Learning"}
            </button>
          </form>
        </Panel>
      </div>

      {/* This month's entries */}
      <Panel>
        <h2 className="font-bold text-ink-strong" style={{ fontSize: 18 }}>
          This month&rsquo;s learning
        </h2>
        <p className="mt-1 text-ink-muted" style={{ fontSize: 14 }}>
          {month.monthLabel}
        </p>

        <div className="mt-4">
          {month.entries.length === 0 ? (
            <EmptyState
              title="Nothing logged yet this month"
              sub="Add your first self-learning entry on the left."
            />
          ) : (
            <ul className="grid gap-2.5">
              {month.entries.map((e) => {
                const Icon = KIND_ICON[e.kind];
                const evidenced = (e.evidenceLink ?? "").trim().length > 0;
                return (
                  <li
                    key={e.id}
                    className="rounded-chip p-4 bg-surface-soft"
                    style={{ border: "1px solid var(--color-hairline)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
                          <Icon
                            size={14}
                            strokeWidth={2.4}
                            className="inline mr-1.5 -mt-0.5 text-ink-subtle"
                          />
                          {e.source}
                        </p>
                        <p className="mt-1 text-ink-subtle" style={{ fontSize: 13 }}>
                          {e.entryDate} · {e.minutes} min
                          {!evidenced && (
                            <span
                              className="ml-2 font-bold"
                              style={{ color: "var(--color-amber-deep)" }}
                            >
                              · no evidence, not counted
                            </span>
                          )}
                        </p>
                        {e.notes && (
                          <p className="mt-1.5 text-ink-muted" style={{ fontSize: 13.5 }}>
                            {e.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {evidenced && (
                          <a
                            href={e.evidenceLink!}
                            target="_blank"
                            rel="noreferrer noopener"
                            title="Evidence"
                            className="inline-flex items-center justify-center rounded-lg"
                            style={{
                              width: 30,
                              height: 30,
                              border: "1px solid var(--color-hairline)",
                              color: TRAINING_ACCENT,
                            }}
                          >
                            <ExternalLink size={14} strokeWidth={2.4} />
                          </a>
                        )}
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => {
                            if (!confirm("Delete this entry?")) return;
                            startTransition(async () => {
                              const res = await deleteSelfLearning(e.id);
                              if (res.ok) toast.success("Deleted");
                              else toast.error(res.error);
                            });
                          }}
                          className="inline-flex items-center justify-center rounded-lg"
                          style={{
                            width: 30,
                            height: 30,
                            border: "1px solid var(--color-hairline)",
                            color: "var(--color-red-deep)",
                          }}
                        >
                          <Trash2 size={14} strokeWidth={2.4} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="block mb-1.5 uppercase font-bold tracking-[0.08em] text-ink-subtle"
      style={{ fontSize: 11.5 }}
    >
      {children}
    </span>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
    />
  );
}
