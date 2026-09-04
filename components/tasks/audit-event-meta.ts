import type { TaskEventType } from "@/lib/events";

export function dotColorFor(e: TaskEventType): string {
  switch (e) {
    case "created":
      return "var(--color-blue)";
    case "status_changed":
      return "var(--color-amber)";
    case "field_updated":
      return "var(--color-ink-subtle)";
    case "reassigned":
      return "var(--color-purple)";
    case "transferred_external":
      return "var(--color-purple-deep)";
    case "priority_changed":
    case "due_changed":
      return "var(--color-amber)";
    case "archived":
    case "restored":
      return "var(--color-rose)";
    case "commented":
      return "var(--color-green)";
    // A manager's ruling reads as decisive, not as another edit.
    case "approval_decided":
      return "var(--color-green)";
    case "time_logged":
      return "var(--color-blue)";
    case "checklist_updated":
      return "var(--color-ink-subtle)";
    case "abandoned":
      return "var(--color-rose)";
    case "nudged":
      return "var(--color-amber)";
  }
}

export function eventFilterBucket(
  e: TaskEventType,
): "comments" | "status" | "edits" {
  switch (e) {
    case "commented":
      return "comments";
    case "status_changed":
    case "reassigned":
    case "transferred_external":
    case "archived":
    case "restored":
      return "status";
    case "created":
    case "field_updated":
    case "priority_changed":
    case "due_changed":
      return "edits";
    // Sign-off, abandonment and a nudge are all "what happened to this task",
    // which is what the status filter means — not content edits.
    case "approval_decided":
    case "abandoned":
    case "nudged":
      return "status";
    case "time_logged":
    case "checklist_updated":
      return "edits";
  }
}
