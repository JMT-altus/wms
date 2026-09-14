import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { format, formatDistanceToNow } from "date-fns";
import { Calendar, ChevronRight, Sparkles, ArrowRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { TaskDetail as TaskDetailModel } from "@/lib/queries/tasks";
import type { PlanTrailStep } from "@/lib/queries/plan";
import { isExecutable, type PlanKind } from "@/lib/plan/levels";
import type { TaskPriority } from "@/db/enums";

/** What each rung of the plan is called, for the lineage strip. */
const PLAN_STEP_LABEL: Partial<Record<PlanKind, string>> = {
  project: "Project",
  milestone: "Milestone",
  result: "Result",
  action: "Action",
  sub_action: "Sub-action",
  sub_sub_action: "Sub-sub-action",
};

const PRIORITY_PILL: Record<
  TaskPriority,
  { label: string; rgb: string; toneVar: string }
> = {
  imp_urgent: {
    label: "Urgent · Important",
    rgb: "225, 6, 0",
    toneVar: "var(--color-red-deep)",
  },
  imp_not_urgent: {
    label: "Important · Not urgent",
    rgb: "59, 130, 246",
    toneVar: "var(--color-blue-deep)",
  },
  not_imp_urgent: {
    label: "Not important · Urgent",
    rgb: "245, 158, 11",
    toneVar: "var(--color-amber-deep)",
  },
  not_imp_not_urgent: {
    label: "Not important · Not urgent",
    rgb: "100, 116, 139",
    toneVar: "var(--color-ink-soft)",
  },
};

/**
 * Read-mode hero treatment for a task.  Editorial-document feel:
 * eyebrow priority chip, oversized serif subject, meta avatars row,
 * then the description body and (when present) internal notes.
 */
export function TaskDetail({
  task,
  planTrail = [],
}: {
  task: TaskDetailModel;
  /**
   * The plan rows above this task — Project › Milestone › Result — when it
   * was raised from an Action or Sub-action.
   *
   * A task from the plan used to arrive on this page with no way to tell what
   * it belonged to: the row it came from is four levels down a tree this
   * screen cannot see, and "New action" on its own says nothing about why the
   * work exists. The task has always carried `project_node_id`; this is that
   * id read out loud.
   */
  planTrail?: PlanTrailStep[];
}) {
  const eyebrow = PRIORITY_PILL[task.priority];
  // sir's changes #11 — the HERO is the task itself (its description = the
  // work to do), not the client name. The form writes Client Name into both
  // `title` and `client`, so the client gets its own clearly-labelled field
  // below the hero instead of dominating as the headline.
  const description = task.description?.trim() || null;
  const clientName = task.client?.trim() || task.title?.trim() || null;
  const headline =
    description || task.subject?.trim() || clientName || "Untitled task";
  const subjectChip = task.subject?.trim() || null;
  const overdue =
    task.dueAt.getTime() < Date.now() &&
    !["approved", "cancelled", "transferred"].includes(task.status);

  /**
   * The rungs worth drawing.
   *
   * Every container the task sits under, plus the executable rows above it —
   * dropping only the LAST rung when that rung is the executable row the task
   * IS, because the headline below already says its name.
   *
   * It used to drop the last rung unconditionally, which was right for a task
   * hanging off an Action and wrong for one hanging off a Result: the Result
   * was the last rung, so the very thing the task was filed under went
   * unnamed. Tasks created through the new form's Project → Milestone →
   * Result picker all hang off a Result.
   */
  const rungs = React.useMemo(() => {
    const last = planTrail[planTrail.length - 1];
    return last && isExecutable(last.kind) ? planTrail.slice(0, -1) : planTrail;
  }, [planTrail]);

  return (
    <article className="relative">
      {/* Eyebrow row — overdue/due pill + created-ago text + subject chip.
          Matches the design comp where small meta sits ABOVE the title. */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <DuePill dueAt={task.dueAt} overdue={overdue} />
        <span className="text-[14px] text-ink-subtle">
          Created {formatDistanceToNow(task.createdAt, { addSuffix: true })}
        </span>
        {subjectChip && (
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-[12.5px] font-bold uppercase tracking-[0.08em] border"
            style={{
              background: "var(--color-surface-soft)",
              color: "var(--color-ink-muted)",
              borderColor: "var(--color-hairline-strong)",
            }}
          >
            {subjectChip}
          </span>
        )}
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-bold tracking-[0.08em] uppercase"
          style={{
            background: `rgba(${eyebrow.rgb}, 0.10)`,
            color: eyebrow.toneVar,
            border: `1px solid rgba(${eyebrow.rgb}, 0.25)`,
          }}
        >
          <Sparkles size={12} strokeWidth={2.6} />
          {eyebrow.label}
        </span>
      </div>

      {/* WHERE THIS CAME FROM — the plan lineage, above the headline, because
          it is the context you read the headline IN. Each rung carries its
          REF ("M2", "RD") beside the name: that is how the plan is quoted in
          conversation, and a milestone named "New Milestone" three times over
          is only tellable apart by its number.
          Each is a link into the plan, scoped to its project, so "which
          project is this?" is one click rather than a hunt through the tree. */}
      {rungs.length > 0 && (
        <nav
          aria-label="Where this sits in the plan"
          className="flex items-center gap-1.5 flex-wrap mb-3"
        >
          {rungs.map((step, i) => (
            <React.Fragment key={step.id}>
              {i > 0 && (
                <ChevronRight
                  size={13}
                  strokeWidth={2.6}
                  className="text-ink-subtle shrink-0"
                  aria-hidden
                />
              )}
              <Link
                href={
                  `/project-plan/views?project=${planTrail[0]!.id}` as Route
                }
                title={`${PLAN_STEP_LABEL[step.kind] ?? step.kind} ${step.ref}: ${step.name}`}
                className="inline-flex items-center gap-1.5 rounded-pill px-2.5 h-6 hover:underline"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  background: "var(--color-surface-soft)",
                  border: "1px solid var(--color-hairline)",
                  color: i === 0 ? "var(--color-ink-strong)" : "var(--color-ink-muted)",
                }}
              >
                <span
                  className="uppercase tracking-[0.08em] shrink-0"
                  style={{ fontSize: 9.5, color: "var(--color-ink-subtle)" }}
                >
                  {PLAN_STEP_LABEL[step.kind] ?? step.kind}
                </span>
                {step.ref && (
                  <span
                    className="shrink-0 tabular-nums"
                    style={{ fontSize: 11, fontWeight: 800, color: "var(--color-altus-red)" }}
                  >
                    {step.ref}
                  </span>
                )}
                <span className="truncate" style={{ maxWidth: 260 }}>
                  {step.name}
                </span>
              </Link>
            </React.Fragment>
          ))}
        </nav>
      )}

      {/* HEADLINE — the task itself (its description). The biggest element on
          the page; serif, sized to stay legible whether it's a phrase or a
          paragraph. */}
      <h1
        className="text-ink-strong"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 500,
          fontSize: "clamp(21px, 1.9vw, 28px)",
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
          // Preserve the line breaks the author typed (multi-line descriptions
          // like an imported list of clients/notes) instead of collapsing them
          // into one run-on paragraph — matches the list hover preview. A
          // single-line title renders identically. `balance` only helps short
          // headings, so it's only applied when there are no newlines.
          whiteSpace: "pre-wrap",
          textWrap: headline.includes("\n") ? "wrap" : "balance",
        }}
      >
        {headline}
      </h1>

      {/* CLIENT — prominent but clearly secondary to the task headline. */}
      {clientName && (
        <div className="mt-4">
          <span className="block text-[12px] uppercase tracking-[0.10em] text-ink-subtle font-bold">
            Client
          </span>
          <span
            className="block text-ink-strong mt-0.5"
            style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}
          >
            {clientName}
          </span>
        </div>
      )}

      {/* Attribution strip — created-by / initiator → doer avatars */}
      <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4">
        {task.creatorName && (
          <PersonChip
            label="Created by"
            name={task.creatorName}
            relative={task.createdAt}
          />
        )}
        <RolePair
          fromName={task.initiatorName}
          fromLabel="Initiator"
          toName={task.doerName}
          toLabel="Doer"
        />
      </div>

      {/* The task description is now the hero above (sir's changes #11), so it
          is no longer repeated here as body prose. */}

      {/* Internal notes — boxed sub-card, distinct from the body. The
          design comp shows it as its own clear region with a labeled
          header inside the main task card. */}
      {task.notes && (
        <div
          className="mt-9 rounded-chip px-6 py-5"
          style={{
            background: "var(--color-surface-soft)",
            border: "1px solid var(--color-hairline)",
            maxWidth: "68ch",
          }}
        >
          <h2
            className="text-ink-subtle font-bold mb-3"
            style={{
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Internal Notes
          </h2>
          <p
            className="text-ink whitespace-pre-wrap"
            style={{ fontSize: 17, lineHeight: 1.6 }}
          >
            {task.notes}
          </p>
        </div>
      )}
    </article>
  );
}

function DuePill({ dueAt, overdue }: { dueAt: Date; overdue: boolean }) {
  const rgb = overdue ? "225, 6, 0" : "100, 116, 139";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] tabular-nums"
      style={{
        background: `rgba(${rgb}, 0.08)`,
        color: overdue ? "var(--color-red-deep)" : "var(--color-ink-soft)",
        border: `1px solid rgba(${rgb}, ${overdue ? 0.30 : 0.16})`,
        fontWeight: 700,
      }}
      title={format(dueAt, "EEE, MMM d, yyyy")}
    >
      <Calendar size={14} strokeWidth={2.4} />
      {overdue ? "Overdue · " : "Due "}
      {format(dueAt, "MMM d")}
    </span>
  );
}

function PersonChip({
  label,
  name,
  relative,
}: {
  label: string;
  name: string;
  relative?: Date;
}) {
  return (
    <span className="inline-flex items-center gap-2.5 text-ink-soft">
      <Avatar name={name} size={28} />
      <span className="leading-tight">
        <span className="block text-[12px] uppercase tracking-[0.10em] text-ink-subtle font-bold">
          {label}
        </span>
        <span className="block text-ink-strong font-semibold mt-0.5" style={{ fontSize: 15.5 }}>
          {name}
          {relative && (
            <span className="ml-1.5 text-ink-subtle font-normal text-[13.5px]">
              · {formatDistanceToNow(relative, { addSuffix: true })}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

function RolePair({
  fromName,
  fromLabel,
  toName,
  toLabel,
}: {
  fromName: string | null;
  fromLabel: string;
  toName: string | null;
  toLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Avatar name={fromName ?? "?"} size={28} title={`${fromLabel}: ${fromName ?? "—"}`} />
      <span className="leading-tight">
        <span className="block text-[12px] uppercase tracking-[0.10em] text-ink-subtle font-bold">
          {fromLabel}
        </span>
        <span className="block text-ink-strong font-semibold mt-0.5" style={{ fontSize: 15.5 }}>
          {fromName ?? "—"}
        </span>
      </span>
      <ArrowRight
        size={16}
        strokeWidth={2.4}
        className="text-ink-subtle mx-1.5"
      />
      <Avatar name={toName ?? "?"} size={28} title={`${toLabel}: ${toName ?? "—"}`} />
      <span className="leading-tight">
        <span className="block text-[12px] uppercase tracking-[0.10em] text-ink-subtle font-bold">
          {toLabel}
        </span>
        <span className="block text-ink-strong font-semibold mt-0.5" style={{ fontSize: 15.5 }}>
          {toName ?? "—"}
        </span>
      </span>
    </span>
  );
}
