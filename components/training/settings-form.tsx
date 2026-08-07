"use client";
import * as React from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import type { TrainingSettings } from "@/lib/queries/training";
import { saveTrainingSettings } from "@/app/(app)/training/actions";
import { Panel, TRAINING_ACCENT, TRAINING_ACCENT_SOFT } from "./ui";

/**
 * Every number the Training module enforces, in one editable place. Adding a
 * knob here means adding a column in org_settings + a field below — no other
 * file needs to know.
 */
export function TrainingSettingsForm({ current }: { current: TrainingSettings }) {
  const [target, setTarget] = React.useState(current.selfLearningTargetMin);
  const [share, setShare] = React.useState(current.shareMinMinutes);
  const [cadence, setCadence] = React.useState(current.cadenceDays);
  const [pending, startTransition] = React.useTransition();

  const dirty =
    target !== current.selfLearningTargetMin ||
    share !== current.shareMinMinutes ||
    cadence !== current.cadenceDays;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveTrainingSettings({
        selfLearningTargetMin: target,
        shareMinMinutes: share,
        cadenceDays: cadence,
      });
      if (res.ok) toast.success("Training policy saved");
      else toast.error(res.error);
    });
  }

  return (
    <form onSubmit={submit}>
      <Panel>
        <h2 className="font-bold text-ink-strong" style={{ fontSize: 18 }}>
          Policy
        </h2>
        <p className="mt-1 text-ink-muted" style={{ fontSize: 14 }}>
          These drive the progress bars, the minimums and the reminder banner across
          the whole Training Centre. Changing them here changes them everywhere.
        </p>

        <div className="mt-5 grid gap-5">
          <Knob
            label="Self-learning target"
            unit="minutes per month"
            value={target}
            onChange={setTarget}
            min={1}
            max={10080}
            help={`Currently ${(target / 60).toFixed(1)} hours a month. Drives the Self-Learning progress bar and the Obligations column.`}
          />
          <Knob
            label="Weekly share minimum"
            unit="minutes"
            value={share}
            onChange={setShare}
            min={1}
            max={600}
            help="The shortest share that counts. Shares below this are rejected when logged."
          />
          <Knob
            label="Session cadence"
            unit="days"
            value={cadence}
            onChange={setCadence}
            min={1}
            max={365}
            help="The Calendar warns when the last session was longer ago than this."
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          {dirty && (
            <span className="text-ink-subtle font-semibold" style={{ fontSize: 13.5 }}>
              Unsaved changes
            </span>
          )}
          <button
            type="submit"
            disabled={pending || !dirty}
            className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-white font-bold disabled:opacity-50"
            style={{
              fontSize: 15,
              background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
              boxShadow: dirty ? "0 10px 22px -10px rgba(11,124,138,0.6)" : "none",
            }}
          >
            <Save size={16} strokeWidth={2.4} />
            {pending ? "Saving…" : "Save policy"}
          </button>
        </div>
      </Panel>
    </form>
  );
}

function Knob({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  help,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  help: string;
}) {
  return (
    <div
      className="rounded-chip p-4 bg-surface-soft"
      style={{ border: "1px solid var(--color-hairline)" }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="font-bold text-ink-strong" style={{ fontSize: 15.5 }}>
            {label}
          </p>
          <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
            {help}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="rounded-chip px-3.5 h-11 bg-surface-card border border-hairline outline-none text-[16px] font-bold text-ink-strong tabular-nums"
            style={{ width: 110 }}
          />
          <span className="font-semibold text-ink-subtle" style={{ fontSize: 13.5 }}>
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
}
